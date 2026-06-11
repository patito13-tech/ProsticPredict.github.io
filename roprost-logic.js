/* =====================================================================
   ROPROST PREDICT — MOTOR DE PREDICCIÓN  (roprost-logic.js)
   ---------------------------------------------------------------------
   Modelo estadístico REAL basado en la distribución de Poisson.
   No inventa porcentajes: los calcula a partir de los datos del equipo.

   MEJORAS (v2):
   - La línea de goles y de córners se elige PARTIDO POR PARTIDO: se toma
     la línea confiable más CERCANA al valor esperado (λ), por lo que la
     recomendación se mueve con cada encuentro y deja de repetirse.
   - El lado (Más / Menos) respeta el tipo de partido (abierto / cerrado).
   - Si no hay datos suficientes, devuelve "Sin pick seguro" y no inventa.
   - Cada pronóstico incluye una explicación breve de por qué se eligió.
   ===================================================================== */

const RoprostEngine = (() => {

  const CONFIG = {
    UMBRAL_MINIMO: 70,      // confianza mínima para mostrar una línea
    UMBRAL_CORNERS: 72,     // los córners son estimados → exigimos algo más
    MAX_PRONOSTICOS_PARTIDO: 3,
    MAX_TOP_APUESTAS: 10,
    MAX_PICKS_DIA: 3,
    PICK_DIA_MINIMO: 80,
    VENTAJA_LOCAL: 1.10,
    AJUSTE_VISITANTE: 0.95,
    MAX_GOLES_MATRIZ: 8,
    LINEAS_GOLES: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
    LINEAS_CORNERS: [6.5, 7.5, 8.5, 9.5, 10.5, 11.5]
  };

  /* ---------------- Poisson ---------------- */
  function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
  function poisson(k, lambda) { return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k); }
  function poissonMayorQue(linea, lambda, techo = 25) { const minimo = Math.ceil(linea); let acc = 0; for (let k = minimo; k <= techo; k++) acc += poisson(k, lambda); return acc; }
  function poissonMenorQue(linea, lambda, techo = 25) { return 1 - poissonMayorQue(linea, lambda, techo); }

  /* ---------------- valores esperados ---------------- */
  function golesEsperados(local, visitante) {
    return {
      lambdaLocal: ((local.gf + visitante.ga) / 2) * CONFIG.VENTAJA_LOCAL,
      lambdaVisitante: ((visitante.gf + local.ga) / 2) * CONFIG.AJUSTE_VISITANTE
    };
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
    return { local: pLocal, empate: pEmpate, visita: pVisita, dobleLocal: pLocal + pEmpate, dobleVisita: pVisita + pEmpate };
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

  /* ---------------------------------------------------------------
     SELECCIÓN DE LÍNEA ÚNICA (la mejora central)
     Para un mercado (goles o córners) evalúa TODAS las líneas por los
     dos lados (Más / Menos) y se queda con la opción que:
       1) supere el umbral de confianza,
       2) esté lo más CERCA posible del valor esperado (λ) → la más
          informativa y, sobre todo, la que cambia de un partido a otro,
       3) respete el tipo de partido como criterio de desempate
          (ABIERTO prefiere "Más", CERRADO prefiere "Menos").
     Devuelve null si ninguna línea es confiable.
  --------------------------------------------------------------- */
  function mejorLineaUnica(lineas, lambda, umbral, etiquetaTipo, tipoPartido) {
    const candidatos = [];
    for (const linea of lineas) {
      const pOver = poissonMayorQue(linea, lambda) * 100;
      const pUnder = poissonMenorQue(linea, lambda) * 100;
      candidatos.push({ linea, lado: "over", prob: pOver, dist: Math.abs(lambda - linea) });
      candidatos.push({ linea, lado: "under", prob: pUnder, dist: Math.abs(lambda - linea) });
    }
    const viables = candidatos.filter(c => c.prob >= umbral);
    if (!viables.length) return null;

    // El tipo de partido manda sobre el lado:
    //   ABIERTO  → preferimos "Más"  (over)
    //   CERRADO  → preferimos "Menos" (under)
    //   EQUILIBRADO → sin lado forzado (el más cercano y conservador)
    const ladoPreferido = tipoPartido === "ABIERTO" ? "over" : tipoPartido === "CERRADO" ? "under" : null;

    // ordenar siempre por cercanía a λ (más informativo) y luego por confianza
    const ordenar = (arr) => arr.sort((a, b) => (a.dist - b.dist) || (b.prob - a.prob));

    let pool = viables;
    if (ladoPreferido) {
      const delLado = viables.filter(c => c.lado === ladoPreferido);
      if (delLado.length) pool = delLado; // si el lado preferido es viable, lo usamos
    }
    ordenar(pool);

    const best = pool[0];
    const etiqueta = best.lado === "over"
      ? `Más de ${best.linea} ${etiquetaTipo}`
      : `Menos de ${best.linea} ${etiquetaTipo}`;
    return { linea: best.linea, lado: best.lado, prob: best.prob, etiqueta };
  }

  function mejorDobleOportunidad(mercado, local, visitante, umbral) {
    const dc1x = mercado.dobleLocal * 100;
    const dcx2 = mercado.dobleVisita * 100;
    if (dc1x < umbral && dcx2 < umbral) return null;
    if (dc1x >= dcx2 && dc1x >= umbral) return { etiqueta: `${local.name} gana o empata (1X)`, prob: dc1x, familia: "doble", mercado: "Doble oportunidad" };
    return { etiqueta: `${visitante.name} gana o empata (X2)`, prob: dcx2, familia: "doble", mercado: "Doble oportunidad" };
  }

  /* ---------------- explicaciones breves ---------------- */
  function motivoGoles(linea, tipoPartido, lambdaGoles) {
    const tp = tipoPartido.toLowerCase();
    if (linea.lado === "over") return `Se proyectan ≈ ${lambdaGoles.toFixed(2)} goles (partido ${tp}); "${linea.etiqueta}" es la línea de Más confiable más cercana a esa cifra.`;
    return `Se proyectan ≈ ${lambdaGoles.toFixed(2)} goles (partido ${tp}); "${linea.etiqueta}" es la línea de Menos confiable más ajustada al pronóstico.`;
  }
  function motivoCorners(linea, lambdaCorners) {
    return `Ritmo estimado ≈ ${lambdaCorners.toFixed(1)} córners (valor aproximado); "${linea.etiqueta}" es la línea confiable más cercana a ese ritmo.`;
  }
  function motivoDoble(c) {
    return `La doble oportunidad "${c.etiqueta}" es la salida más segura según las probabilidades 1/X/2.`;
  }

  /* ---------------- análisis de un partido ---------------- */
  function analizarPartido(partido) {
    const { local, visitante } = partido;

    // ¿hay datos reales? La capa de datos marca statsReales=false cuando
    // tuvo que usar valores por defecto (sin tabla de posiciones).
    const datosSuficientes = (local.statsReales !== false) && (visitante.statsReales !== false);

    const { lambdaLocal, lambdaVisitante } = golesEsperados(local, visitante);
    const lambdaGoles = lambdaLocal + lambdaVisitante;
    const lambdaCorners = cornersEsperados(local, visitante);
    const mercado = matrizMarcadores(lambdaLocal, lambdaVisitante);
    const tipoPartido = clasificarPartido(lambdaLocal, lambdaVisitante);

    const base = {
      ...partido,
      tipoPartido,
      lambdaLocal: +lambdaLocal.toFixed(2),
      lambdaVisitante: +lambdaVisitante.toFixed(2),
      lambdaGoles: +lambdaGoles.toFixed(2),
      lambdaCorners: +lambdaCorners.toFixed(2),
      probVictoria: {
        local: Math.round(mercado.local * 100),
        empate: Math.round(mercado.empate * 100),
        visitante: Math.round(mercado.visita * 100),
        dobleLocal: Math.round(mercado.dobleLocal * 100),
        dobleVisitante: Math.round(mercado.dobleVisita * 100)
      }
    };

    if (!datosSuficientes) {
      return { ...base, pronosticos: [], confianzaGeneral: 0, hayValor: false, sinDatos: true, motivoGeneral: "Sin pick seguro: faltan datos reales del equipo (no hay tabla de posiciones disponible)." };
    }

    const candidatos = [];

    // ---- Goles: UNA sola línea ----
    const lineaGoles = mejorLineaUnica(CONFIG.LINEAS_GOLES, lambdaGoles, CONFIG.UMBRAL_MINIMO, "goles", tipoPartido);
    if (lineaGoles) candidatos.push({ etiqueta: lineaGoles.etiqueta, prob: lineaGoles.prob, mercado: "Goles", motivo: motivoGoles(lineaGoles, tipoPartido, lambdaGoles) });

    // ---- Córners: UNA sola línea (estimación) ----
    const lineaCorners = mejorLineaUnica(CONFIG.LINEAS_CORNERS, lambdaCorners, CONFIG.UMBRAL_CORNERS, "córners", tipoPartido);
    if (lineaCorners) candidatos.push({ etiqueta: lineaCorners.etiqueta, prob: lineaCorners.prob, mercado: "Córners", motivo: motivoCorners(lineaCorners, lambdaCorners) });

    // ---- Doble oportunidad ----
    const doble = mejorDobleOportunidad(mercado, local, visitante, CONFIG.UMBRAL_MINIMO);
    if (doble) candidatos.push({ ...doble, motivo: motivoDoble(doble) });

    // Ordena por confianza y limita a un mercado por tipo (sin contradicciones)
    candidatos.sort((a, b) => b.prob - a.prob);
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
        mercado: c.mercado,
        motivo: c.motivo
      };
    });

    const confianzaGeneral = pronosticos.length ? Math.round(pronosticos.reduce((s, p) => s + p.confianza, 0) / pronosticos.length) : 0;

    return {
      ...base,
      pronosticos,
      confianzaGeneral,
      hayValor: pronosticos.length > 0,
      sinDatos: false,
      motivoGeneral: pronosticos.length ? "" : "Sin pick seguro: ninguna línea supera el umbral de confianza en este partido."
    };
  }

  function analizarTodos(partidos) { return partidos.map(analizarPartido); }

  function topApuestas(partidosAnalizados) {
    let bets = partidosAnalizados.filter(p => p.hayValor).map(p => ({ partido: `${p.local.name} vs ${p.visitante.name}`, liga: p.liga, ...p.pronosticos[0] }));
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
        if (pr.confianza >= CONFIG.PICK_DIA_MINIMO) todos.push({ partido: `${p.local.name} vs ${p.visitante.name}`, liga: p.liga, ...pr, motivo: pr.motivo || motivoPick(p, pr) });
      });
    });
    todos.sort((a, b) => b.confianza - a.confianza);
    return todos.slice(0, CONFIG.MAX_PICKS_DIA);
  }

  /* ---------------- evaluación de resultados ---------------- */
  function lineaDeTexto(texto) {
    const match = String(texto || "").replace(",", ".").match(/\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : NaN;
  }

  // Convierte a número SOLO si hay un valor real; "", null y undefined → NaN
  // (así no se confunde "sin dato" con "cero", que causaba falsos "perdido").
  function numReal(v) {
    if (v === "" || v === null || v === undefined) return NaN;
    const x = Number(v);
    return Number.isFinite(x) ? x : NaN;
  }

  function evaluarPronostico(pr, partidoTerminado) {
    const gl = numReal(partidoTerminado.golesLocal);
    const gv = numReal(partidoTerminado.golesVisitante);
    const texto = pr.etiqueta || "";

    if (pr.mercado === "Goles") {
      if (!Number.isFinite(gl) || !Number.isFinite(gv)) return "pendiente";
      const totalGoles = gl + gv;
      const linea = lineaDeTexto(texto);
      if (!Number.isFinite(linea)) return "pendiente";
      if (texto.startsWith("Más")) return totalGoles > linea ? "acertado" : "fallado";
      if (texto.startsWith("Menos")) return totalGoles < linea ? "acertado" : "fallado";
    }

    if (pr.mercado === "Córners") {
      const cl = numReal(partidoTerminado.cornersLocal);
      const cv = numReal(partidoTerminado.cornersVisitante);
      if (!Number.isFinite(cl) || !Number.isFinite(cv)) return "pendiente"; // NO EVALUABLE
      const totalCorners = cl + cv;
      const linea = lineaDeTexto(texto);
      if (!Number.isFinite(linea)) return "pendiente";
      if (texto.startsWith("Más")) return totalCorners > linea ? "acertado" : "fallado";
      if (texto.startsWith("Menos")) return totalCorners < linea ? "acertado" : "fallado";
    }

    if (pr.mercado === "Doble oportunidad") {
      if (!Number.isFinite(gl) || !Number.isFinite(gv)) return "pendiente";
      const local = gl > gv;
      const empate = gl === gv;
      const visitante = gv > gl;
      if (texto.includes("(1X)")) return (local || empate) ? "acertado" : "fallado";
      if (texto.includes("(X2)")) return (visitante || empate) ? "acertado" : "fallado";
    }

    return "pendiente";
  }

  function evaluarCombinada(pronosticos, partido) {
    if (partido.enVivo) return "vivo";
    if (!pronosticos || !pronosticos.length) return "pendiente";
    const estados = pronosticos.map(pr => evaluarPronostico(pr, partido));
    if (estados.includes("fallado")) return "fallado";       // un solo fallo → PERDIDA
    if (estados.every(e => e === "acertado")) return "acertado"; // todos aciertan → GANADA
    return "pendiente";                                       // algo NO EVALUABLE → pendiente
  }

  function motivoPick(p, pr) {
    if (pr.mercado === "Goles") return `El modelo proyecta ≈ ${p.lambdaGoles} goles totales. Solo una línea de goles para evitar mercados contradictorios.`;
    if (pr.mercado === "Córners") return `Proyección de ≈ ${p.lambdaCorners} córners (estimado). Solo una línea de córners.`;
    return `Opción conservadora: ${pr.etiqueta}.`;
  }

  return { CONFIG, analizarPartido, analizarTodos, topApuestas, picksDelDia, etiquetaConfianza, etiquetaRiesgo, evaluarPronostico, evaluarCombinada };
})();

if (typeof window !== "undefined") window.RoprostEngine = RoprostEngine;
if (typeof module !== "undefined") module.exports = RoprostEngine;
