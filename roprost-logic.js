/* =====================================================================
   ROPROST PREDICT — MOTOR DE PREDICCIÓN v3  (roprost-logic.js)
   ---------------------------------------------------------------------
   Motor profesional basado en Poisson con análisis contextual real.
   - Evalúa TODAS las líneas posibles antes de elegir
   - Elige la línea más cercana al valor esperado (no siempre la misma)
   - Umbrales más estrictos para córners (que llegan sin datos reales)
   - Pick del día: mínimo 85%, máximo 5
   - Máximo 3 pronósticos por partido, ordenados por confianza
   - Explicaciones detalladas basadas en los datos reales del equipo
   ===================================================================== */

const RoprostEngine = (() => {

  const CONFIG = {
    UMBRAL_GOLES:        72,   // mínimo para mostrar línea de goles
    UMBRAL_DOBLE:        72,   // mínimo para doble oportunidad
    UMBRAL_CORNERS:      78,   // más estricto porque son estimados
    MAX_PICKS_PARTIDO:    3,
    MAX_TOP_APUESTAS:    10,
    MAX_PICKS_DIA:        5,
    PICK_DIA_MINIMO:     85,   // solo lo realmente seguro
    VENTAJA_LOCAL:       1.10,
    AJUSTE_VISITANTE:    0.95,
    MAX_GOLES_MATRIZ:     8,
    // Evaluamos TODAS estas líneas y elegimos la más informativa
    LINEAS_GOLES:    [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
    LINEAS_CORNERS:  [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5]
  };

  /* ── Poisson ─────────────────────────────────────────────────────── */
  function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
  function poisson(k, l) { return (Math.pow(l, k) * Math.exp(-l)) / factorial(k); }
  function poissonOver(linea, lambda, techo = 30) {
    const min = Math.ceil(linea);
    let acc = 0;
    for (let k = min; k <= techo; k++) acc += poisson(k, lambda);
    return acc;
  }
  function poissonUnder(linea, lambda, techo = 30) { return 1 - poissonOver(linea, lambda, techo); }

  /* ── Valores esperados ───────────────────────────────────────────── */
  function golesEsperados(local, visitante) {
    return {
      lambdaLocal:     ((local.gf    + visitante.ga) / 2) * CONFIG.VENTAJA_LOCAL,
      lambdaVisitante: ((visitante.gf + local.ga)    / 2) * CONFIG.AJUSTE_VISITANTE
    };
  }

  function cornersEsperados(local, visitante) {
    // Estimación conservadora basada en perfil ofensivo/defensivo
    // cf/ca viene de standings; si son los defaults (4.5) el resultado
    // será el promedio de la liga, no un valor inflado
    const base = (local.cf + visitante.ca + visitante.cf + local.ca) / 2;
    // Ajuste por tipo de partido: equipos muy ofensivos generan más corners
    const factorOfensivo = Math.min(1.15, (local.gf + visitante.gf) / 2.8);
    return +(base * factorOfensivo).toFixed(2);
  }

  function matrizMarcadores(lh, la) {
    const N = CONFIG.MAX_GOLES_MATRIZ;
    let pL = 0, pE = 0, pV = 0;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const p = poisson(i, lh) * poisson(j, la);
        if (i > j) pL += p;
        else if (i === j) pE += p;
        else pV += p;
      }
    }
    return {
      local: pL, empate: pE, visita: pV,
      dobleLocal:   pL + pE,
      dobleVisita:  pV + pE
    };
  }

  function clasificarPartido(lh, la) {
    const t = lh + la;
    if (t >= 2.8) return "ABIERTO";
    if (t <= 2.1) return "CERRADO";
    return "EQUILIBRADO";
  }

  /* ── Selección de línea ──────────────────────────────────────────── */
  /**
   * Evalúa TODAS las líneas por ambos lados.
   * Elige la que:
   *   1. Supera el umbral de confianza
   *   2. Está más CERCA del lambda esperado (la más informativa)
   *   3. Respeta el tipo de partido como desempate
   * Devuelve null si ninguna pasa el umbral.
   */
  function mejorLinea(lineas, lambda, umbral, tipoPartido) {
    const candidatos = [];
    for (const linea of lineas) {
      const pOver  = poissonOver(linea, lambda) * 100;
      const pUnder = poissonUnder(linea, lambda) * 100;
      const dist   = Math.abs(lambda - linea);
      if (pOver  >= umbral) candidatos.push({ linea, lado: "over",  prob: pOver,  dist });
      if (pUnder >= umbral) candidatos.push({ linea, lado: "under", prob: pUnder, dist });
    }
    if (!candidatos.length) return null;

    // Lado preferido según tipo de partido
    const ladoPref = tipoPartido === "ABIERTO" ? "over"
                   : tipoPartido === "CERRADO" ? "under"
                   : null;

    // Ordenar por cercanía a lambda (más informativo), desempate por probabilidad
    const ordenar = arr => arr.sort((a, b) => (a.dist - b.dist) || (b.prob - a.prob));

    let pool = candidatos;
    if (ladoPref) {
      const delLado = candidatos.filter(c => c.lado === ladoPref);
      if (delLado.length) pool = delLado;
    }
    ordenar(pool);
    return pool[0];
  }

  /* ── Etiquetas ───────────────────────────────────────────────────── */
  function etiquetaLinea(res, tipo) {
    return res.lado === "over"
      ? `Más de ${res.linea} ${tipo}`
      : `Menos de ${res.linea} ${tipo}`;
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
    if (pct >= 80) return { texto: "Segura",     clase: "riesgo-amarillo" };
    if (pct >= 75) return { texto: "Moderada",   clase: "riesgo-naranja" };
    return              { texto: "Evitar",       clase: "riesgo-rojo" };
  }

  /* ── Explicaciones contextuales ──────────────────────────────────── */
  function motivoGoles(res, lambdaGoles, tipoPartido, local, visitante) {
    const tp   = tipoPartido.toLowerCase();
    const gfL  = local.gf.toFixed(2);
    const gaL  = local.ga.toFixed(2);
    const gfV  = visitante.gf.toFixed(2);
    const gaV  = visitante.ga.toFixed(2);
    const lado = res.lado === "over" ? "Más" : "Menos";
    return `Partido ${tp}. ${local.name} anota ${gfL}/partido y recibe ${gaL}. ${visitante.name} anota ${gfV} y recibe ${gaV}. Proyección: ≈${lambdaGoles.toFixed(2)} goles totales. "${lado} de ${res.linea} goles" es la línea más segura y cercana a esa cifra.`;
  }

  function motivoCorners(res, lambdaCorners, local, visitante) {
    const cfL = local.cf.toFixed(1);
    const caL = local.ca.toFixed(1);
    const cfV = visitante.cf.toFixed(1);
    const caV = visitante.ca.toFixed(1);
    const lado = res.lado === "over" ? "Más" : "Menos";
    return `${local.name} genera ≈${cfL} y concede ≈${caL} córners/partido. ${visitante.name}: ≈${cfV} y ≈${caV}. Total estimado: ≈${lambdaCorners.toFixed(1)} córners. "${lado} de ${res.linea} córners" es la línea confiable más ajustada al partido.`;
  }

  function motivoDoble(etiq, local, visitante, mercado) {
    const eLocal = mercado.dobleLocal * 100;
    const eVisit = mercado.dobleVisita * 100;
    if (etiq.includes("(1X)")) return `${local.name} tiene ${eLocal.toFixed(0)}% de probabilidad de ganar o empatar. La doble oportunidad 1X es la salida más conservadora para este partido.`;
    return `${visitante.name} tiene ${eVisit.toFixed(0)}% de probabilidad de ganar o empatar. La doble oportunidad X2 es la salida más conservadora para este partido.`;
  }

  /* ── Análisis de un partido ──────────────────────────────────────── */
  function analizarPartido(partido) {
    const { local, visitante } = partido;
    const datosSuficientes = local.statsReales !== false && visitante.statsReales !== false;

    const { lambdaLocal, lambdaVisitante } = golesEsperados(local, visitante);
    const lambdaGoles   = lambdaLocal + lambdaVisitante;
    const lambdaCorners = cornersEsperados(local, visitante);
    const mercado       = matrizMarcadores(lambdaLocal, lambdaVisitante);
    const tipoPartido   = clasificarPartido(lambdaLocal, lambdaVisitante);

    const base = {
      ...partido,
      tipoPartido,
      lambdaLocal:     +lambdaLocal.toFixed(2),
      lambdaVisitante: +lambdaVisitante.toFixed(2),
      lambdaGoles:     +lambdaGoles.toFixed(2),
      lambdaCorners:   +lambdaCorners.toFixed(2),
      probVictoria: {
        local:           Math.round(mercado.local  * 100),
        empate:          Math.round(mercado.empate * 100),
        visitante:       Math.round(mercado.visita * 100),
        dobleLocal:      Math.round(mercado.dobleLocal  * 100),
        dobleVisitante:  Math.round(mercado.dobleVisita * 100)
      }
    };

    if (!datosSuficientes) {
      return { ...base, pronosticos: [], confianzaGeneral: 0, hayValor: false, sinDatos: true,
        motivoGeneral: "Sin pick seguro: faltan datos reales del equipo." };
    }

    const candidatos = [];

    /* ── 1. GOLES: evalúa todas las líneas, elige la mejor ── */
    const rGoles = mejorLinea(CONFIG.LINEAS_GOLES, lambdaGoles, CONFIG.UMBRAL_GOLES, tipoPartido);
    if (rGoles) {
      candidatos.push({
        etiqueta: etiquetaLinea(rGoles, "goles"),
        prob:     rGoles.prob,
        mercado:  "Goles",
        motivo:   motivoGoles(rGoles, lambdaGoles, tipoPartido, local, visitante)
      });
    }

    /* ── 2. CÓRNERS: solo si la estimación es confiable ── */
    // Si los stats son los defaults (cf=4.5, ca=4.5) el lambda es genérico;
    // en ese caso subimos el umbral para no recomendar líneas infladas.
    const statsDefaultLocal = !local.statsReales || (local.cf === 4.5 && local.ca === 4.5);
    const statsDefaultVisit = !visitante.statsReales || (visitante.cf === 4.5 && visitante.ca === 4.5);
    const umbralCornersEfectivo = (statsDefaultLocal || statsDefaultVisit)
      ? 88   // muy estricto si son estimaciones genéricas
      : CONFIG.UMBRAL_CORNERS;

    const rCorners = mejorLinea(CONFIG.LINEAS_CORNERS, lambdaCorners, umbralCornersEfectivo, tipoPartido);
    if (rCorners) {
      candidatos.push({
        etiqueta: etiquetaLinea(rCorners, "córners"),
        prob:     rCorners.prob,
        mercado:  "Córners",
        motivo:   motivoCorners(rCorners, lambdaCorners, local, visitante)
      });
    }

    /* ── 3. DOBLE OPORTUNIDAD ── */
    const dc1x = mercado.dobleLocal  * 100;
    const dcx2 = mercado.dobleVisita * 100;
    const mejorDoble = (dc1x >= dcx2 && dc1x >= CONFIG.UMBRAL_DOBLE)
      ? { etiqueta: `${local.name} gana o empata (1X)`,    prob: dc1x }
      : (dcx2 >= CONFIG.UMBRAL_DOBLE)
        ? { etiqueta: `${visitante.name} gana o empata (X2)`, prob: dcx2 }
        : null;
    if (mejorDoble) {
      candidatos.push({
        ...mejorDoble,
        mercado: "Doble oportunidad",
        motivo:  motivoDoble(mejorDoble.etiqueta, local, visitante, mercado)
      });
    }

    /* ── Ordenar por confianza, 1 mercado por tipo, máx 3 ── */
    candidatos.sort((a, b) => b.prob - a.prob);
    const usados = new Set();
    const seleccionados = [];
    for (const c of candidatos) {
      if (usados.has(c.mercado)) continue;
      usados.add(c.mercado);
      seleccionados.push(c);
      if (seleccionados.length >= CONFIG.MAX_PICKS_PARTIDO) break;
    }

    const pronosticos = seleccionados.map(c => {
      const confianza = Math.round(c.prob);
      const riesgo    = etiquetaRiesgo(confianza);
      return {
        etiqueta:   c.etiqueta,
        confianza,
        nivel:      etiquetaConfianza(c.prob),
        riesgo:     riesgo.texto,
        riesgoClase:riesgo.clase,
        mercado:    c.mercado,
        motivo:     c.motivo
      };
    });

    const confianzaGeneral = pronosticos.length
      ? Math.round(pronosticos.reduce((s, p) => s + p.confianza, 0) / pronosticos.length)
      : 0;

    return {
      ...base,
      pronosticos,
      confianzaGeneral,
      hayValor:       pronosticos.length > 0,
      sinDatos:       false,
      motivoGeneral:  pronosticos.length ? "" : "Sin pick seguro: ninguna línea supera el umbral de confianza."
    };
  }

  function analizarTodos(partidos) { return partidos.map(analizarPartido); }

  /* ── Top Apuestas ────────────────────────────────────────────────── */
  function topApuestas(analizados) {
    let bets = analizados
      .filter(p => p.hayValor)
      .map(p => ({
        partido:   `${p.local.name} vs ${p.visitante.name}`,
        liga:      p.liga,
        ...p.pronosticos[0]
      }));

    // Filtro dinámico: mostrar lo mejor disponible
    const sobre85 = bets.filter(b => b.confianza >= 85).length;
    const sobre80 = bets.filter(b => b.confianza >= 80).length;
    if (sobre85 >= 3)      bets = bets.filter(b => b.confianza >= 80);
    else if (sobre80 >= 3) bets = bets.filter(b => b.confianza >= 75);

    bets.sort((a, b) => b.confianza - a.confianza);
    return bets.slice(0, CONFIG.MAX_TOP_APUESTAS);
  }

  /* ── Picks del día ───────────────────────────────────────────────── */
  function picksDelDia(analizados) {
    const todos = [];
    analizados.forEach(p => {
      if (!p.hayValor) return;
      p.pronosticos.forEach(pr => {
        if (pr.confianza >= CONFIG.PICK_DIA_MINIMO) {
          todos.push({
            partido:   `${p.local.name} vs ${p.visitante.name}`,
            liga:      p.liga,
            ...pr
          });
        }
      });
    });
    todos.sort((a, b) => b.confianza - a.confianza);
    return todos.slice(0, CONFIG.MAX_PICKS_DIA);
  }

  /* ── Evaluación de resultados ────────────────────────────────────── */
  function lineaDeTexto(texto) {
    const m = String(texto || "").replace(",", ".").match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  function numReal(v) {
    if (v === "" || v === null || v === undefined) return NaN;
    const x = Number(v);
    return Number.isFinite(x) ? x : NaN;
  }

  function evaluarPronostico(pr, p) {
    const gl = numReal(p.golesLocal);
    const gv = numReal(p.golesVisitante);
    const texto = pr.etiqueta || "";

    if (pr.mercado === "Goles") {
      if (!Number.isFinite(gl) || !Number.isFinite(gv)) return "pendiente";
      const total = gl + gv;
      const linea = lineaDeTexto(texto);
      if (!Number.isFinite(linea)) return "pendiente";
      if (texto.startsWith("Más"))   return total > linea ? "acertado" : "fallado";
      if (texto.startsWith("Menos")) return total < linea ? "acertado" : "fallado";
    }

    if (pr.mercado === "Córners") {
      const cl = numReal(p.cornersLocal);
      const cv = numReal(p.cornersVisitante);
      if (!Number.isFinite(cl) || !Number.isFinite(cv)) return "pendiente";
      const total = cl + cv;
      const linea = lineaDeTexto(texto);
      if (!Number.isFinite(linea)) return "pendiente";
      if (texto.startsWith("Más"))   return total > linea ? "acertado" : "fallado";
      if (texto.startsWith("Menos")) return total < linea ? "acertado" : "fallado";
    }

    if (pr.mercado === "Doble oportunidad") {
      if (!Number.isFinite(gl) || !Number.isFinite(gv)) return "pendiente";
      if (texto.includes("(1X)")) return (gl >= gv) ? "acertado" : "fallado";
      if (texto.includes("(X2)")) return (gv >= gl) ? "acertado" : "fallado";
    }

    return "pendiente";
  }

  function evaluarCombinada(pronosticos, partido) {
    if (partido.enVivo) return "vivo";
    if (!pronosticos || !pronosticos.length) return "pendiente";
    const estados = pronosticos.map(pr => evaluarPronostico(pr, partido));
    if (estados.includes("fallado"))            return "fallado";
    if (estados.every(e => e === "acertado"))   return "acertado";
    return "pendiente";
  }

  return {
    CONFIG,
    analizarPartido,
    analizarTodos,
    topApuestas,
    picksDelDia,
    etiquetaConfianza,
    etiquetaRiesgo,
    evaluarPronostico,
    evaluarCombinada
  };
})();

if (typeof window !== "undefined") window.RoprostEngine = RoprostEngine;
if (typeof module !== "undefined") module.exports = RoprostEngine;
