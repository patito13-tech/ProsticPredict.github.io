/* =====================================================================
   ROPROST PREDICT — MOTOR DE PREDICCIÓN  (roprost-logic.js)
   ---------------------------------------------------------------------
   Modelo estadístico REAL basado en la distribución de Poisson.
   No inventa porcentajes: los calcula a partir de los datos del equipo.
   ===================================================================== */

const RoprostEngine = (() => {

  const CONFIG = {
    UMBRAL_MINIMO: 70,
    MAX_PRONOSTICOS_PARTIDO: 3,
    MAX_TOP_APUESTAS: 10,
    MAX_PICKS_DIA: 3,
    PICK_DIA_MINIMO: 80,
    VENTAJA_LOCAL: 1.10,
    AJUSTE_VISITANTE: 0.95,
    MAX_GOLES_MATRIZ: 8,
    LINEAS_GOLES: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
    LINEAS_CORNERS: [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]
  };

  function factorial(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function poisson(k, lambda) {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
  }

  function poissonMayorQue(linea, lambda, techo = 20) {
    const minimo = Math.ceil(linea);
    let acumulado = 0;
    for (let k = minimo; k <= techo; k++) acumulado += poisson(k, lambda);
    return acumulado;
  }

  function poissonMenorQue(linea, lambda, techo = 20) {
    return 1 - poissonMayorQue(linea, lambda, techo);
  }

  function golesEsperados(local, visitante) {
    const lambdaLocal = ((local.gf + visitante.ga) / 2) * CONFIG.VENTAJA_LOCAL;
    const lambdaVisitante = ((visitante.gf + local.ga) / 2) * CONFIG.AJUSTE_VISITANTE;
    return { lambdaLocal, lambdaVisitante };
  }

  function cornersEsperados(local, visitante) {
    const cLocal = (local.cf + visitante.ca) / 2;
    const cVisitante = (visitante.cf + local.ca) / 2;
    return cLocal + cVisitante;
  }

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
      dobleLocal: pLocal + pEmpate,
      dobleVisita: pVisita + pEmpate
    };
  }

  function clasificarPartido(lh, la) {
    const totalEsperado = lh + la;
    if (totalEsperado >= 2.7) return "ABIERTO";
    if (totalEsperado <= 2.2) return "CERRADO";
    return "EQUILIBRADO";
  }

  function etiquetaConfianza(pct) {
    if (pct >= 95) return "Excelente";
    if (pct >= 90) return "Muy alta";
    if (pct >= 85) return "Alta";
    if (pct >= 80) return "Buena";
    if (pct >= 75) return "Aceptable";
    return "Última opción";
  }

  function etiquetaRiesgo(pct) {
    if (pct >= 85) return { texto: "Muy segura", clase: "riesgo-verde" };
    if (pct >= 80) return { texto: "Segura", clase: "riesgo-amarillo" };
    if (pct >= 75) return { texto: "Moderada", clase: "riesgo-naranja" };
    return { texto: "Evitar", clase: "riesgo-rojo" };
  }

  function mejorLineaMayor(lineas, lambda, umbral, tipo) {
    let elegida = null;
    for (const linea of lineas) {
      const prob = poissonMayorQue(linea, lambda) * 100;
      if (prob >= umbral) elegida = { linea, prob };
    }
    return elegida ? { ...elegida, etiqueta: `Más de ${elegida.linea} ${tipo}` } : null;
  }

  function mejorLineaMenor(lineas, lambda, umbral, tipo) {
    for (const linea of lineas) {
      const prob = poissonMenorQue(linea, lambda) * 100;
      if (prob >= umbral) return { linea, prob, etiqueta: `Menos de ${linea} ${tipo}` };
    }
    return null;
  }

  function elegirMercadoUnico(over, under, tipoPartido) {
    if (!over && !under) return null;
    if (over && !under) return over;
    if (!over && under) return under;
    if (tipoPartido === "CERRADO") return under;
    if (tipoPartido === "ABIERTO") return over;
    return over.prob >= under.prob ? over : under;
  }

  function mejorDobleOportunidad(mercado, local, visitante, umbral) {
    const dc1x = mercado.dobleLocal * 100;
    const dcx2 = mercado.dobleVisita * 100;

    if (dc1x < umbral && dcx2 < umbral) return null;

    if (dc1x >= dcx2 && dc1x >= umbral) {
      return {
        etiqueta: `${local.name} gana o empata (1X)`,
        prob: dc1x,
        familia: "doble",
        mercado: "Doble oportunidad"
      };
    }

    return {
      etiqueta: `${visitante.name} gana o empata (X2)`,
      prob: dcx2,
      familia: "doble",
      mercado: "Doble oportunidad"
    };
  }

  function analizarPartido(partido) {
    const { local, visitante } = partido;
    const { lambdaLocal, lambdaVisitante } = golesEsperados(local, visitante);
    const lambdaGoles = lambdaLocal + lambdaVisitante;
    const lambdaCorners = cornersEsperados(local, visitante);
    const mercado = matrizMarcadores(lambdaLocal, lambdaVisitante);
    const tipoPartido = clasificarPartido(lambdaLocal, lambdaVisitante);
    const U = CONFIG.UMBRAL_MINIMO;

    const candidatos = [];

    const overGoles = mejorLineaMayor(CONFIG.LINEAS_GOLES, lambdaGoles, U, "goles");
    const underGoles = mejorLineaMenor(CONFIG.LINEAS_GOLES, lambdaGoles, U, "goles");
    const golesUnico = elegirMercadoUnico(overGoles, underGoles, tipoPartido);
    if (golesUnico) {
      candidatos.push({
        ...golesUnico,
        familia: golesUnico.etiqueta.startsWith("Más") ? "goles_over" : "goles_under",
        mercado: "Goles"
      });
    }

    const overCorners = mejorLineaMayor(CONFIG.LINEAS_CORNERS, lambdaCorners, U, "córners");
    const underCorners = mejorLineaMenor(CONFIG.LINEAS_CORNERS, lambdaCorners, U, "córners");
    const cornerUnico = elegirMercadoUnico(overCorners, underCorners, tipoPartido);
    if (cornerUnico) {
      candidatos.push({
        ...cornerUnico,
        familia: cornerUnico.etiqueta.startsWith("Más") ? "corners_over" : "corners_under",
        mercado: "Córners"
      });
    }

    const doble = mejorDobleOportunidad(mercado, local, visitante, U);
    if (doble) candidatos.push(doble);

    const prioriza = (c) => {
      if (c.mercado === "Doble oportunidad") return 2;
      if (tipoPartido === "CERRADO" && (c.familia === "goles_under" || c.familia === "corners_under")) return 1;
      if (tipoPartido === "ABIERTO" && (c.familia === "goles_over" || c.familia === "corners_over")) return 1;
      return 0;
    };

    candidatos.sort((a, b) => (b.prob - a.prob) || (prioriza(b) - prioriza(a)));

    const seleccionados = [];
    const mercadosUsados = new Set();

    for (const c of candidatos) {
      if (mercadosUsados.has(c.mercado)) continue;
      mercadosUsados.add(c.mercado);
      seleccionados.push(c);
      if (seleccionados.length >= CONFIG.MAX_PRONOSTICOS_PARTIDO) break;
    }

    const pronosticos = seleccionados.map(c => {
      const confianza = Math.round(c.prob);
      const riesgo = etiquetaRiesgo(confianza);
      return {
        etiqueta: c.etiqueta,
        confianza,
        nivel: etiquetaConfianza(c.prob),
        riesgo: riesgo.texto,
        riesgoClase: riesgo.clase,
        mercado: c.mercado
      };
    });

    const confianzaGeneral = pronosticos.length
      ? Math.round(pronosticos.reduce((s, p) => s + p.confianza, 0) / pronosticos.length)
      : 0;

    return {
      ...partido,
      tipoPartido,
      lambdaGoles: +lambdaGoles.toFixed(2),
      lambdaCorners: +lambdaCorners.toFixed(2),
      probVictoria: {
        local: Math.round(mercado.local * 100),
        empate: Math.round(mercado.empate * 100),
        visitante: Math.round(mercado.visita * 100),
        dobleLocal: Math.round(mercado.dobleLocal * 100),
        dobleVisitante: Math.round(mercado.dobleVisita * 100)
      },
      pronosticos,
      confianzaGeneral,
      hayValor: pronosticos.length > 0
    };
  }

  function analizarTodos(partidos) {
    return partidos.map(analizarPartido);
  }

  function topApuestas(partidosAnalizados) {
    let bets = partidosAnalizados
      .filter(p => p.hayValor)
      .map(p => ({
        partido: `${p.local.name} vs ${p.visitante.name}`,
        liga: p.liga,
        ...p.pronosticos[0]
      }));

    const sobre85 = bets.filter(b => b.confianza >= 85).length;
    const sobre80 = bets.filter(b => b.confianza >= 80).length;
    if (sobre85 >= 3) bets = bets.filter(b => b.confianza >= 80);
    else if (sobre80 >= 3) bets = bets.filter(b => b.confianza >= 75);

    bets.sort((a, b) => b.confianza - a.confianza);
    return bets.slice(0, CONFIG.MAX_TOP_APUESTAS);
  }

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

  function evaluarPronostico(pr, partidoTerminado) {
    const gl = Number(partidoTerminado.golesLocal);
    const gv = Number(partidoTerminado.golesVisitante);
    if (!Number.isFinite(gl) || !Number.isFinite(gv)) return "pendiente";
    const totalGoles = gl + gv;
    const texto = pr.etiqueta || "";

    if (pr.mercado === "Goles") {
      const linea = parseFloat(texto.replace(",", ".").match(/\d+(\.\d+)?/)?.[0]);
      if (!Number.isFinite(linea)) return "pendiente";
      if (texto.startsWith("Más")) return totalGoles > linea ? "acertado" : "fallado";
      if (texto.startsWith("Menos")) return totalGoles < linea ? "acertado" : "fallado";
    }

    if (pr.mercado === "Doble oportunidad") {
      const local = gl > gv;
      const empate = gl === gv;
      const visitante = gv > gl;
      if (texto.includes("(1X)")) return (local || empate) ? "acertado" : "fallado";
      if (texto.includes("(X2)")) return (visitante || empate) ? "acertado" : "fallado";
    }

    return "pendiente";
  }

  function motivoPick(p, pr) {
    if (pr.mercado === "Goles" && pr.etiqueta.startsWith("Más")) {
      return `El modelo proyecta ~${p.lambdaGoles} goles totales. Se muestra solo una línea de goles para evitar mercados contradictorios.`;
    }
    if (pr.mercado === "Goles") {
      return `Encuentro ${p.tipoPartido.toLowerCase()}: se muestra solo una línea de goles para evitar mercados contradictorios.`;
    }
    if (pr.mercado === "Córners") {
      return `Proyección de ~${p.lambdaCorners} córners totales. Se muestra solo una línea de córners para evitar mercados contradictorios.`;
    }
    return `Opción conservadora: ${pr.etiqueta}.`;
  }

  return {
    CONFIG,
    analizarPartido,
    analizarTodos,
    topApuestas,
    picksDelDia,
    etiquetaConfianza,
    etiquetaRiesgo,
    evaluarPronostico
  };
})();

window.RoprostEngine = RoprostEngine;
