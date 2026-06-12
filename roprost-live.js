/* =====================================================================
   ROPROST PREDICT — MOTOR DE PREDICCIÓN  (roprost-logic.js)
   ---------------------------------------------------------------------
   Modelo estadístico REAL basado en la distribución de Poisson.
   No inventa porcentajes: los calcula a partir de los datos del equipo.

   MEJORAS (v3):
   - CÓRNERS DESACTIVADOS: la API no provee datos reales de córners, así
     que el mercado queda apagado (CORNERS_ACTIVOS=false). Si algún día
     hay datos reales, se reactiva y solo se muestra cuando ambos equipos
     tengan córners reales (cornersReales=true).
   - SELECCIÓN DE LÍNEA MÁS ESTRICTA: una línea solo es válida si está
     CERCA del valor esperado (no triviales lejanas) y NO es casi-segura
     sin valor (ej. "Más de 0.5" al 95%). Esto elimina los picks de
     relleno y deja los informativos.
   - Si no hay datos suficientes, devuelve "Sin pick seguro".
   ===================================================================== */

const RoprostEngine = (() => {

  const CONFIG = {
    UMBRAL_MINIMO: 70,      // confianza mínima para mostrar una línea
    UMBRAL_CORNERS: 72,     // los córners exigen algo más (cuando se reactiven)
    CORNERS_ACTIVOS: false, // ← córners apagados: la API no da datos reales
    MAX_PRONOSTICOS_PARTIDO: 3,
    MAX_TOP_APUESTAS: 10,
    MAX_PICKS_DIA: 3,
    PICK_DIA_MINIMO: 80,
    VENTAJA_LOCAL: 1.10,
    AJUSTE_VISITANTE: 0.95,
    MAX_GOLES_MATRIZ: 8,
    // Caps para que una línea no sea ni trivialmente lejana ni casi-segura:
    MAX_DIST_GOLES: 2.0,    // la línea de goles no puede estar a más de 2.0 de λ
    MAX_DIST_CORNERS: 2.0,  // ídem córners (para cuando se reactiven)
    PROB_MAX_GOLES: 92,     // descarta líneas casi-seguras sin valor
    PROB_MAX_CORNERS: 88,
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
    // Solo tiene sentido si hay córners reales; si no, devuelve null.
    if (local.cf == null || local.ca == null || visitante.cf == null || visitante.ca == null) return null;
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
     SELECCIÓN DE LÍNEA ÚNICA
     Una línea es VIABLE si:
       1) supera el umbral de confianza,
       2) NO es trivialmente segura (prob <= probMax) → sin valor,
       3) NO está demasiado lejos del valor esperado (dist <= maxDist).
     Se elige la más cercana a λ, respetando el tipo de partido.
     Devuelve null si ninguna línea cumple.
  --------------------------------------------------------------- */
  function mejorLineaUnica(lineas, lambda, umbral, etiquetaTipo, tipoPartido, maxDist, probMax) {
    if (lambda == null || !Number.isFinite(lambda)) return null;
    const candidatos = [];
    for (const linea of lineas) {
      const pOver = poissonMayorQue(linea, lambda) * 100;
      const pUnder = poissonMenorQue(linea, lambda) * 100;
      candidatos.push({ linea, lado: "over", prob: pOver, dist: Math.abs(lambda - linea) });
      candidatos.push({ linea, lado: "under", prob: pUnder, dist: Math.abs(lambda - linea) });
    }
    const viables = candidatos.filter(c =>
      c.prob >= umbral && c.prob <= probMax && c.dist <= maxDist
    );
    if (!viables.length) return null;

    const ladoPreferido = tipoPartido === "ABIERTO" ? "over" : tipoPartido === "CERRADO" ? "under" : null;
    const ordenar = (arr) => arr.sort((a, b) => (a.dist - b.dist) || (b.prob - a.prob));

    let pool = viables;
    if (ladoPreferido) {
      const delLado = viables.filter(c => c.lado === ladoPreferido);
      if (delLado.length) pool = delLado;
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
    return `Ritmo estimado ≈ ${lambdaCorners.toFixed(1)} córners; "${linea.etiqueta}" es la línea confiable más cercana a ese ritmo.`;
  }
  function motivoDoble(c) {
    return `La doble oportunidad "${c.etiqueta}" es la salida más segura según las probabilidades 1/X/2.`;
  }

  /* ---------------- análisis de un partido ---------------- */
  function analizarPartido(partido) {
    const { local, visitante } = partido;

    const datosSuficientes = (local.statsReales !== false) && (visitante.statsReales !== false);

    const { lambdaLocal, lambdaVisitante } = golesEsperados(local, visitante);
    const lambdaGoles = lambdaLocal + lambdaVisitante;
    const lambdaCorners = cornersEsperados(local, visitante); // null si no hay córners reales
    const mercado = matrizMarcadores(lambdaLocal, lambdaVisitante);
    const tipoPartido = clasificarPartido(lambdaLocal, lambdaVisitante);

    const base = {
      ...partido,
      tipoPartido,
      lambdaLocal: +lambdaLocal.toFixed(2),
      lambdaVisitante: +lambdaVisitante.toFixed(2),
      lambdaGoles: +lambdaGoles.toFixed(2),
      lambdaCorners: lambdaCorners != null ? +lambdaCorners.toFixed(2) : null,
      probVictoria: {
        local: Math.round(mercado.local * 100),
        empate: Math.round(mercado.empate * 100),
        visitante: Math.round(mercado.visita * 100),
        dobleLocal: Math.round(mercado.dobleLocal * 100),
        dobleVisitante: Math.round(mercado.dobleVisita * 100)
      }
    };

    if (!datosSuficientes) {
      return { ...base, pronosticos: [], confianzaGeneral: 0, hayValor: false, sinDatos: true, motivoGeneral: "Sin pick seguro: faltan datos reales del equipo." };
    }

    const candidatos = [];

    // ---- Goles: UNA sola línea (con caps de distancia y probabilidad) ----
    const lineaGoles = mejorLineaUnica(CONFIG.LINEAS_GOLES, lambdaGoles, CONFIG.UMBRAL_MINIMO,
      "goles", tipoPartido, CONFIG.MAX_DIST_GOLES, CONFIG.PROB_MAX_GOLES);
    if (lineaGoles) candidatos.push({ etiqueta: lineaGoles.etiqueta, prob: lineaGoles.prob, mercado: "Goles", motivo: motivoGoles(lineaGoles, tipoPartido, lambdaGoles) });

    // ---- Córners: solo si el mercado está activo Y ambos equipos tienen córners reales ----
    const cornersFiables = CONFIG.CORNERS_ACTIVOS
      && local.cornersReales && visitante.cornersReales
      && lambdaCorners != null;
    const lineaCorners = cornersFiables
      ? mejorLineaUnica(CONFIG.LINEAS_CORNERS, lambdaCorners, CONFIG.UMBRAL_CORNERS,
          "córners", tipoPartido, CONFIG.MAX_DIST_CORNERS, CONFIG.PROB_MAX_CORNERS)
      : null;
    if (lineaCorners) candidatos.push({ etiqueta: lineaCorners.etiqueta, prob: lineaCorners.prob, mercado: "Córners", motivo: motivoCorners(lineaCorners, lambdaCorners) });

    // ---- Doble oportunidad ----
    const doble = mejorDobleOportunidad(mercado, local, visitante, CONFIG.UMBRAL_MINIMO);
    if (doble) candidatos.push({ ...doble, motivo: motivoDoble(doble) });

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
      if (!Number.isFinite(cl) || !Number.isFinite(cv)) return "pendiente";
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
    if (estados.includes("fallado")) return "fallado";
    if (estados.every(e => e === "acertado")) return "acertado";
    return "pendiente";
  }

  function motivoPick(p, pr) {
    if (pr.mercado === "Goles") return `El modelo proyecta ≈ ${p.lambdaGoles} goles totales.`;
    if (pr.mercado === "Córners") return `Proyección de ≈ ${p.lambdaCorners} córners.`;
    return `Opción conservadora: ${pr.etiqueta}.`;
  }

  return { CONFIG, analizarPartido, analizarTodos, topApuestas, picksDelDia, etiquetaConfianza, etiquetaRiesgo, evaluarPronostico, evaluarCombinada };
})();

if (typeof window !== "undefined") window.RoprostEngine = RoprostEngine;
if (typeof module !== "undefined") module.exports = RoprostEngine;
