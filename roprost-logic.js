/* =====================================================================
   ROPROST PREDICT — MOTOR DE PREDICCIÓN  (roprost-logic.js)
   ---------------------------------------------------------------------
   Modelo estadístico REAL basado en la distribución de Poisson.
   No inventa porcentajes: los calcula a partir de los datos del equipo
   (goles a favor/en contra, córners, ventaja de local).

   IMPORTANTE / HONESTIDAD:
   Ningún modelo puede garantizar aciertos. Estos porcentajes son
   PROBABILIDADES ESTIMADAS, no certezas. Líneas conservadoras como
   "Más de 0.5 goles" sí alcanzan ~90% de forma legítima; los mercados
   ajustados (Más de 2.5) rara vez superan el 65-70%.
   ===================================================================== */

const RoprostEngine = (() => {

  /* ---------- Configuración del modelo ---------- */
  const CONFIG = {
    UMBRAL_MINIMO: 70,        // Filtro de seguridad: nada por debajo se muestra
    MAX_PRONOSTICOS_PARTIDO: 3,
    MAX_TOP_APUESTAS: 10,
    MAX_PICKS_DIA: 3,
    PICK_DIA_MINIMO: 80,
    VENTAJA_LOCAL: 1.10,      // pequeño boost ofensivo de local
    AJUSTE_VISITANTE: 0.95,
    MAX_GOLES_MATRIZ: 8,      // tamaño de la matriz de marcadores
    LINEAS_GOLES: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
    LINEAS_CORNERS: [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]
  };

  /* ---------- Utilidades de Poisson ---------- */
  function factorial(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }
  // P(X = k) para una variable de Poisson con media lambda
  function poisson(k, lambda) {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
  }
  // P(X >= line) sumando hasta un techo razonable
  function poissonMayorQue(linea, lambda, techo = 20) {
    // "Más de X.5" = al menos ceil(X.5) goles. Para 0.5 => >=1
    const minimo = Math.ceil(linea);
    let acumulado = 0;
    for (let k = minimo; k <= techo; k++) acumulado += poisson(k, lambda);
    return acumulado;
  }
  function poissonMenorQue(linea, lambda, techo = 20) {
    return 1 - poissonMayorQue(linea, lambda, techo);
  }

  /* ---------- Goles esperados (lambda) ---------- */
  // Combina ataque del local con defensa del visitante (y viceversa)
  function golesEsperados(local, visitante) {
    const lambdaLocal =
      ((local.gf + visitante.ga) / 2) * CONFIG.VENTAJA_LOCAL;
    const lambdaVisitante =
      ((visitante.gf + local.ga) / 2) * CONFIG.AJUSTE_VISITANTE;
    return { lambdaLocal, lambdaVisitante };
  }

  // Córners totales esperados = córners local + córners visitante
  function cornersEsperados(local, visitante) {
    const cLocal = (local.cf + visitante.ca) / 2;
    const cVisitante = (visitante.cf + local.ca) / 2;
    return cLocal + cVisitante; // un solo lambda para el total
  }

  /* ---------- Matriz de marcadores -> mercados 1X2 / Doble oportunidad ---------- */
  function matrizMarcadores(lh, la) {
    const N = CONFIG.MAX_GOLES_MATRIZ;
    let pLocal = 0, pEmpate = 0, pVisita = 0;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const p = poisson(i, lh) * poisson(j, la);
        if (i > j) pLocal += p;
        else if (i === j) pEmpate += p;
        else pVisita += p;
      }
    }
    return {
      local: pLocal,
      empate: pEmpate,
      visita: pVisita,
      dobleLocal: pLocal + pEmpate,   // 1X
      dobleVisita: pVisita + pEmpate  // X2
    };
  }

  /* ---------- Clasificación del partido ---------- */
  function clasificarPartido(lh, la) {
    const totalEsperado = lh + la;
    // > 2.7 goles esperados => abierto;  < 2.2 => cerrado;  resto = equilibrado
    if (totalEsperado >= 2.7) return "ABIERTO";
    if (totalEsperado <= 2.2) return "CERRADO";
    return "EQUILIBRADO";
  }

  /* ---------- Escala de confianza (tu spec) ---------- */
  function etiquetaConfianza(pct) {
    if (pct >= 95) return "Excelente";
    if (pct >= 90) return "Muy alta";
    if (pct >= 85) return "Alta";
    if (pct >= 80) return "Buena";
    if (pct >= 75) return "Aceptable";
    return "Última opción";
  }

  /* ---------- Selección de la mejor línea de una familia ----------
     Para "Más de": elige la línea MÁS ALTA que aún supere el umbral
     (más informativa pero segura). Para "Menos de": la MÁS BAJA segura.
     Esto implementa el "ajuste automático a líneas conservadoras". */
  function mejorLineaMayor(lineas, lambda, umbral, tipo) {
    let elegida = null;
    for (const linea of lineas) {                 // de menor a mayor
      const prob = poissonMayorQue(linea, lambda) * 100;
      if (prob >= umbral) {
        elegida = { linea, prob }; // nos quedamos con la más alta que pase
      }
    }
    return elegida ? { ...elegida, etiqueta: `Más de ${elegida.linea} ${tipo}` } : null;
  }
  function mejorLineaMenor(lineas, lambda, umbral, tipo) {
    for (const linea of lineas) {                 // de menor a mayor: la primera segura
      const prob = poissonMenorQue(linea, lambda) * 100;
      if (prob >= umbral) {
        return { linea, prob, etiqueta: `Menos de ${linea} ${tipo}` };
      }
    }
    return null;
  }

  /* ---------- Generar pronósticos de UN partido ---------- */
  function analizarPartido(partido) {
    const { local, visitante } = partido;
    const { lambdaLocal, lambdaVisitante } = golesEsperados(local, visitante);
    const lambdaGoles = lambdaLocal + lambdaVisitante;
    const lambdaCorners = cornersEsperados(local, visitante);
    const mercado = matrizMarcadores(lambdaLocal, lambdaVisitante);
    const tipoPartido = clasificarPartido(lambdaLocal, lambdaVisitante);
    const U = CONFIG.UMBRAL_MINIMO;

    const candidatos = [];

    // --- GOLES ---
    const overGoles = mejorLineaMayor(CONFIG.LINEAS_GOLES, lambdaGoles, U, "goles");
    const underGoles = mejorLineaMenor(CONFIG.LINEAS_GOLES, lambdaGoles, U, "goles");
    if (overGoles) candidatos.push({ ...overGoles, familia: "goles_over", mercado: "Goles" });
    if (underGoles) candidatos.push({ ...underGoles, familia: "goles_under", mercado: "Goles" });

    // --- CÓRNERS ---
    const overCorners = mejorLineaMayor(CONFIG.LINEAS_CORNERS, lambdaCorners, U, "córners");
    const underCorners = mejorLineaMenor(CONFIG.LINEAS_CORNERS, lambdaCorners, U, "córners");
    if (overCorners) candidatos.push({ ...overCorners, familia: "corners_over", mercado: "Córners" });
    if (underCorners) candidatos.push({ ...underCorners, familia: "corners_under", mercado: "Córners" });

    // --- DOBLE OPORTUNIDAD ---
    const dc1x = mercado.dobleLocal * 100;
    const dcx2 = mercado.dobleVisita * 100;
    if (dc1x >= U || dcx2 >= U) {
      if (dc1x >= dcx2 && dc1x >= U) {
        candidatos.push({ etiqueta: "Doble oportunidad local (1X)", prob: dc1x, familia: "doble", mercado: "Doble oportunidad" });
      } else if (dcx2 >= U) {
        candidatos.push({ etiqueta: "Doble oportunidad visitante (X2)", prob: dcx2, familia: "doble", mercado: "Doble oportunidad" });
      }
    }

    // Priorización según tipo de partido (pequeño bonus de orden, no altera el %)
    const prioriza = (c) => {
      if (tipoPartido === "CERRADO" &&
        (c.familia === "goles_under" || c.familia === "corners_under" || c.familia === "doble")) return 1;
      if (tipoPartido === "ABIERTO" &&
        (c.familia === "goles_over" || c.familia === "corners_over")) return 1;
      return 0;
    };

    // Ordenar por confianza (desc), con desempate por prioridad de tipo de partido
    candidatos.sort((a, b) => (b.prob - a.prob) || (prioriza(b) - prioriza(a)));

    const pronosticos = candidatos
      .slice(0, CONFIG.MAX_PRONOSTICOS_PARTIDO)
      .map(c => ({
        etiqueta: c.etiqueta,
        confianza: Math.round(c.prob),
        nivel: etiquetaConfianza(c.prob),
        mercado: c.mercado
      }));

    // Confianza general del partido = media de sus mejores pronósticos
    const confianzaGeneral = pronosticos.length
      ? Math.round(pronosticos.reduce((s, p) => s + p.confianza, 0) / pronosticos.length)
      : 0;

    return {
      ...partido,
      tipoPartido,
      lambdaGoles: +lambdaGoles.toFixed(2),
      lambdaCorners: +lambdaCorners.toFixed(2),
      pronosticos,
      confianzaGeneral,
      hayValor: pronosticos.length > 0
    };
  }

  /* ---------- Analizar TODOS los partidos ---------- */
  function analizarTodos(partidos) {
    return partidos.map(analizarPartido);
  }

  /* ---------- TOP APUESTAS (filtro inteligente) ---------- */
  function topApuestas(partidosAnalizados) {
    // mejor pronóstico de cada partido con valor
    let bets = partidosAnalizados
      .filter(p => p.hayValor)
      .map(p => ({
        partido: `${p.local.name} vs ${p.visitante.name}`,
        liga: p.liga,
        ...p.pronosticos[0]
      }));

    // Filtro inteligente de tu spec
    const sobre85 = bets.filter(b => b.confianza >= 85).length;
    const sobre80 = bets.filter(b => b.confianza >= 80).length;
    if (sobre85 >= 3) bets = bets.filter(b => b.confianza >= 80);
    else if (sobre80 >= 3) bets = bets.filter(b => b.confianza >= 75);

    bets.sort((a, b) => b.confianza - a.confianza);
    return bets.slice(0, CONFIG.MAX_TOP_APUESTAS);
  }

  /* ---------- PICKS DEL DÍA ---------- */
  function picksDelDia(partidosAnalizados) {
    const todos = [];
    partidosAnalizados.forEach(p => {
      if (!p.hayValor) return;
      p.pronosticos.forEach(pr => {
        if (pr.confianza >= CONFIG.PICK_DIA_MINIMO) {
          todos.push({
            partido: `${p.local.name} vs ${p.visitante.name}`,
            liga: p.liga,
            ...pr,
            motivo: motivoPick(p, pr)
          });
        }
      });
    });
    todos.sort((a, b) => b.confianza - a.confianza);
    return todos.slice(0, CONFIG.MAX_PICKS_DIA);
  }

  // Explicación breve y honesta basada en los números del modelo
  function motivoPick(p, pr) {
    if (pr.mercado === "Goles" && pr.etiqueta.startsWith("Más")) {
      return `El modelo proyecta ~${p.lambdaGoles} goles totales según el ataque de ${p.local.name} y la defensa de ${p.visitante.name}.`;
    }
    if (pr.mercado === "Goles") {
      return `Encuentro ${p.tipoPartido.toLowerCase()}: el modelo proyecta solo ~${p.lambdaGoles} goles esperados.`;
    }
    if (pr.mercado === "Córners") {
      return `Proyección de ~${p.lambdaCorners} córners totales según el promedio de ambos equipos.`;
    }
    return `Diferencia de nivel y forma reciente favorecen este resultado según el modelo.`;
  }

  /* ---------- API pública ---------- */
  return {
    CONFIG,
    analizarPartido,
    analizarTodos,
    topApuestas,
    picksDelDia,
    etiquetaConfianza
  };
})();

// Exponer global para los demás scripts
window.RoprostEngine = RoprostEngine;
