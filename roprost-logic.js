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
    UMBRAL_GOLES:        70,   // mínimo para mostrar línea de goles
    UMBRAL_DOBLE:        70,   // mínimo para doble oportunidad
    UMBRAL_CORNERS:      78,   // más estricto porque son estimados
    // ── Mercados que se evalúan SOLO con el marcador final (nunca "No evaluable") ──
    UMBRAL_AMBOS:        70,   // (heredado) ambos equipos anotan
    UMBRAL_GOL_EQUIPO:   70,   // equipo favorito marca +0.5
    UMBRAL_RESULTADO:    70,   // (heredado) 1X2
    UMBRAL_NO_EMPATE:    70,   // (heredado) no empate (ahora dentro de Doble)
    MAX_PICKS_PARTIDO:    3,
    MAX_TOP_APUESTAS:    10,
    MAX_PICKS_DIA:        5,
    PICK_DIA_MINIMO:     85,   // solo lo realmente seguro
    VENTAJA_LOCAL:       1.10,
    AJUSTE_VISITANTE:    0.95,
    MAX_GOLES_MATRIZ:     8,
    // Evaluamos TODAS estas líneas y elegimos la más informativa
    LINEAS_GOLES:    [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
    LINEAS_GOL_EQUIPO: [0.5, 1.5, 2.5],   // líneas individuales por equipo (over)
    LINEAS_CORNERS:  [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5]
  };

  /* Orden de preferencia cuando varias apuestas tienen confianza similar.
     Menor número = mayor prioridad. Los córners quedan al final porque sus
     datos finales rara vez llegan (suelen terminar como "No evaluable"); así
     se priorizan los mercados que se resuelven solo con el marcador final. */
  const PRIORIDAD = {
    "Doble oportunidad": 1,
    "Goles favorito":    2,
    "Goles":             3,   // total de goles
    // (claves heredadas, por si quedan picks guardados de versiones previas)
    "Ambos anotan":      4,
    "Goles local":       5,
    "Goles visitante":   6,
    "Resultado":         7,
    "No empate":         8,
    "Córners":           9    // legado: siempre el último (relleno)
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
    // El local juega EN CASA → usa su rendimiento de local; el visitante,
    // su rendimiento de FUERA. Mucho más predictivo que el promedio general.
    // Si no hay split (sin datos), cae al promedio general (gf/ga).
    const lGF = (local.home     && local.home.pj) ? local.home.gf : local.gf;
    const lGA = (local.home     && local.home.pj) ? local.home.ga : local.ga;
    const vGF = (visitante.away && visitante.away.pj) ? visitante.away.gf : visitante.gf;
    const vGA = (visitante.away && visitante.away.pj) ? visitante.away.ga : visitante.ga;
    return {
      lambdaLocal:     ((lGF + vGA) / 2) * CONFIG.VENTAJA_LOCAL,
      lambdaVisitante: ((vGF + lGA) / 2) * CONFIG.AJUSTE_VISITANTE
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

  /* ── Mercados por marcador final ─────────────────────────────────── */
  // Ambos equipos anotan: P(local≥1) · P(visita≥1) bajo Poisson independiente
  function probAmbosAnotan(lh, la) {
    const pLocalMarca  = 1 - Math.exp(-lh);
    const pVisitaMarca = 1 - Math.exp(-la);
    const si = pLocalMarca * pVisitaMarca;
    return { si: si * 100, no: (1 - si) * 100 };
  }

  // Mejor línea OVER para un solo equipo (Local/Visitante marca +X.5)
  function mejorLineaEquipo(lambda, umbral) {
    const cand = [];
    for (const linea of CONFIG.LINEAS_GOL_EQUIPO) {
      const pOver = poissonOver(linea, lambda) * 100;
      if (pOver >= umbral) cand.push({ linea, prob: pOver, dist: Math.abs(lambda - linea) });
    }
    if (!cand.length) return null;
    // La más informativa (cercana al lambda del equipo); desempate por probabilidad
    cand.sort((a, b) => (a.dist - b.dist) || (b.prob - a.prob));
    return cand[0];
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
    if (pct >= 90) return "Muy Alta";
    if (pct >= 80) return "Alta";
    if (pct >= 70) return "Media";
    return "No recomendado";
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

  function motivoDoble(opc, local, visitante, mercado) {
    const eLocal = (mercado.dobleLocal  * 100).toFixed(0);
    const eVisit = (mercado.dobleVisita * 100).toFixed(0);
    const e12    = ((mercado.local + mercado.visita) * 100).toFixed(0);
    const sel = opc.sel || (opc.etiqueta || "");
    if (sel === "1X" || String(sel).includes("(1X)")) return `${local.name} tiene ${eLocal}% de probabilidad de ganar o empatar. La doble oportunidad 1X es la salida más conservadora de este partido.`;
    if (sel === "X2" || String(sel).includes("(X2)")) return `${visitante.name} tiene ${eVisit}% de probabilidad de ganar o empatar. La doble oportunidad X2 es la salida más conservadora de este partido.`;
    return `Hay ${e12}% de probabilidad de que NO haya empate. La doble oportunidad 12 gana si vence cualquiera de los dos equipos. Se evalúa solo con el marcador final.`;
  }

  function motivoAmbos(sel, lh, la, local, visitante) {
    const pl = ((1 - Math.exp(-lh)) * 100).toFixed(0);
    const pv = ((1 - Math.exp(-la)) * 100).toFixed(0);
    if (sel.sel === "btts_si")
      return `${local.name} marca con ${pl}% de probabilidad y ${visitante.name} con ${pv}%. Lo más probable es que ambos anoten: "Ambos equipos anotan: Sí". Se evalúa solo con el marcador final.`;
    return `Baja probabilidad de que ambos marquen (${local.name} ${pl}%, ${visitante.name} ${pv}%). Lo más seguro es "Ambos equipos anotan: No". Se evalúa solo con el marcador final.`;
  }

  function motivoGolEquipo(nombre, res, lambda, lado) {
    return `${nombre} (${lado}) proyecta ≈${lambda.toFixed(2)} goles. "Marca más de ${res.linea} goles" es su línea individual más segura (${res.prob.toFixed(0)}%). Se evalúa solo con los goles finales de ${nombre}.`;
  }

  function motivoResultado(res, local, visitante, mercado) {
    const pl = (mercado.local * 100).toFixed(0);
    const pe = (mercado.empate * 100).toFixed(0);
    const pv = (mercado.visita * 100).toFixed(0);
    return `Probabilidades 1X2: ${local.name} ${pl}%, empate ${pe}%, ${visitante.name} ${pv}%. "${res.etiqueta}" es el desenlace más probable. Se evalúa solo con el marcador final.`;
  }

  function motivoNoEmpate(local, visitante, mercado) {
    const p = ((mercado.local + mercado.visita) * 100).toFixed(0);
    return `Hay ${p}% de probabilidad de que el partido NO termine en empate. "No empate (12)" gana si vence cualquiera de los dos equipos. Se evalúa solo con el marcador final.`;
  }

  /* ═══════════════════════════════════════════════════════════════════
     ANÁLISIS INTELIGENTE — La IA estudia el partido, redacta su conclusión
     y detecta partidos peligrosos. Todo a partir de datos reales.
     ═══════════════════════════════════════════════════════════════════ */

  function ordinal(n) { return Number.isFinite(n) && n > 0 ? `${n}º` : "—"; }

  // Perfil del equipo según dónde juega ESTE partido (local→casa, visita→fuera)
  function perfilEquipo(team, lado) {
    const s = lado === "local" ? team.home : team.away;
    const usar = (s && s.pj) ? s : null;
    return {
      pj:     usar ? usar.pj : 0,
      w:      usar ? usar.w  : 0,
      d:      usar ? usar.d  : 0,
      l:      usar ? usar.l  : 0,
      gf:     usar ? usar.gf : team.gf,
      ga:     usar ? usar.ga : team.ga,
      winPct: (usar && usar.pj) ? Math.round((usar.w / usar.pj) * 100) : null,
      pos:    Number.isFinite(team.pos) ? team.pos : null
    };
  }

  // Conjunto de señales reales que la IA pondera (no una sola estadística)
  function calcularSenales(local, visitante, ctx) {
    const { lambdaLocal, lambdaVisitante, lambdaGoles, lambdaCorners, mercado, datosCornersFiables } = ctx;
    const pl = perfilEquipo(local, "local");
    const pv = perfilEquipo(visitante, "visitante");
    return {
      pl, pv,
      ofensivaLocal:  lambdaLocal,
      ofensivaVisit:  lambdaVisitante,
      gapGoles:       Math.abs(lambdaLocal - lambdaVisitante),
      overUnder:      lambdaGoles >= 2.8 ? "over" : lambdaGoles <= 2.1 ? "under" : "neutro",
      cornersLean:    lambdaCorners >= 10 ? "alto" : lambdaCorners <= 8 ? "bajo" : "medio",
      datosCornersFiables,
      probMax:        Math.max(mercado.local, mercado.empate, mercado.visita),
      favorito:       mercado.local >= mercado.visita ? "local" : "visitante"
    };
  }

  // Redacta la conclusión del analista a partir de las 3-4 señales más decisivas
  function generarRazonamiento(local, visitante, ctx, senales, pronosticos) {
    const { lambdaGoles } = ctx;
    const { pl, pv } = senales;
    const frases = [];

    if (pl.pj) frases.push(`${local.name} como local registra ${pl.w}V-${pl.d}E-${pl.l}D (${pl.winPct}% de victorias), marca ${pl.gf.toFixed(1)} y recibe ${pl.ga.toFixed(1)} goles por partido.`);
    if (pv.pj) frases.push(`${visitante.name} fuera de casa suma ${pv.w}V-${pv.d}E-${pv.l}D y encaja ${pv.ga.toFixed(1)} goles de promedio.`);

    if (pl.pos && pv.pos) {
      const dif = Math.abs(pl.pos - pv.pos);
      frases.push(dif >= 6
        ? `Hay diferencia de nivel en la tabla (${ordinal(pl.pos)} frente a ${ordinal(pv.pos)}), lo que favorece al mejor situado.`
        : `Están próximos en la tabla (${ordinal(pl.pos)} y ${ordinal(pv.pos)}): partido más parejo de lo que parece.`);
    }

    frases.push(
      senales.overUnder === "over"   ? `El modelo proyecta ≈${lambdaGoles.toFixed(1)} goles totales: tendencia ofensiva, escenario de over.`
    : senales.overUnder === "under"  ? `El modelo proyecta ≈${lambdaGoles.toFixed(1)} goles: partido cerrado, escenario de under.`
    :                                  `El modelo proyecta ≈${lambdaGoles.toFixed(1)} goles, valores equilibrados.`
    );

    const top = pronosticos[0];
    if (top) frases.push(`Conclusión IA: tras comparar los mercados, la opción más sólida es «${top.etiqueta}» con ${top.confianza}% de confianza.`);
    else     frases.push(`Conclusión IA: ningún mercado supera el umbral de seguridad; no se recomienda apostar este partido.`);

    return frases.join(" ");
  }

  // Filtro anti-trampas: detecta riesgo SOLO con señales reales del modelo
  function evaluarRiesgo(local, visitante, ctx, senales, pronosticos) {
    const mejor = pronosticos[0] ? pronosticos[0].confianza : 0;
    const razones = [];
    let nivel = "bajo";

    // Partido impredecible: ningún desenlace claro y sin mercado fuerte
    if (senales.probMax < 0.45 && mejor < 75) {
      razones.push("ningún resultado se impone con claridad y no hay mercado de alta confianza");
      nivel = "alto";
    }
    // Favorito sobrevalorado: gran probabilidad de un lado pero goles esperados casi iguales
    if (senales.probMax > 0.60 && senales.gapGoles < 0.40) {
      razones.push("el favorito lo es por margen estrecho de goles esperados (favorito sobrevalorado)");
      if (nivel !== "alto") nivel = "medio";
    }
    // Inconsistencia casa/fuera marcada
    const irregular = (t, lado) => {
      const s = lado === "local" ? t.home : t.away;
      const o = lado === "local" ? t.away : t.home;
      if (s && o && s.pj >= 4 && o.pj >= 4) return Math.abs((s.w / s.pj) - (o.w / o.pj)) >= 0.45;
      return false;
    };
    if (irregular(local, "local") || irregular(visitante, "visitante")) {
      razones.push("uno de los equipos es muy irregular según juegue de local o visitante");
      if (nivel === "bajo") nivel = "medio";
    }

    const alerta  = nivel !== "bajo";
    const mensaje = alerta
      ? `⚠ Partido de ${nivel === "alto" ? "alta" : "cierta"} incertidumbre: ${razones.join("; ")}. Evitar apuestas agresivas.`
      : "";
    return { alerta, nivel, mensaje, razones };
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
        analisisIA: "IA: No hay datos reales suficientes de estos equipos para un análisis fiable. No se recomienda apostar este partido.",
        alertaIA: { alerta: true, nivel: "alto", mensaje: "⚠ Sin datos suficientes para analizar. Evitar apuestas.", razones: ["faltan estadísticas reales"] },
        cornersInfo: "IA: Datos insuficientes para evaluar córners con confianza.",
        motivoGeneral: "Sin pick seguro: faltan datos reales del equipo." };
    }

    const candidatos = [];

    /* ── 1. TOTAL DE GOLES · solo líneas de alta confiabilidad ──
          Únicamente: Más de 0.5, Más de 1.5, Menos de 4.5. ── */
    const opcGoles = [
      { linea: 0.5, lado: "over",  prob: poissonOver(0.5, lambdaGoles)  * 100 },
      { linea: 1.5, lado: "over",  prob: poissonOver(1.5, lambdaGoles)  * 100 },
      { linea: 4.5, lado: "under", prob: poissonUnder(4.5, lambdaGoles) * 100 }
    ].filter(o => o.prob >= CONFIG.UMBRAL_GOLES)
     .map(o => ({ ...o, dist: Math.abs(lambdaGoles - o.linea) }))
     .sort((a, b) => (a.dist - b.dist) || (b.prob - a.prob));
    const rGoles = opcGoles[0] || null;
    if (rGoles) {
      candidatos.push({
        etiqueta: etiquetaLinea(rGoles, "goles"),
        prob:     rGoles.prob,
        mercado:  "Goles",
        motivo:   motivoGoles(rGoles, lambdaGoles, tipoPartido, local, visitante)
      });
    }

    /* ── 2. DOBLE OPORTUNIDAD · 1X / X2 / 12 ── */
    const opcDoble = [
      { etiqueta: `${local.name} gana o empata (1X)`,     prob: mercado.dobleLocal  * 100, sel: "1X" },
      { etiqueta: `${visitante.name} gana o empata (X2)`, prob: mercado.dobleVisita * 100, sel: "X2" },
      { etiqueta: `No empate · gana cualquiera (12)`,     prob: (mercado.local + mercado.visita) * 100, sel: "12" }
    ].filter(o => o.prob >= CONFIG.UMBRAL_DOBLE)
     .sort((a, b) => b.prob - a.prob);
    const mejorDoble = opcDoble[0] || null;
    if (mejorDoble) {
      candidatos.push({
        ...mejorDoble,
        mercado: "Doble oportunidad",
        motivo:  motivoDoble(mejorDoble, local, visitante, mercado)
      });
    }

    /* ── 3. EQUIPO FAVORITO MARCA MÁS DE 0.5 (anota al menos 1) ──
          Favorito = mayor probabilidad de victoria. Solo marcador final. ── */
    const favLocal = mercado.local >= mercado.visita;
    const lamFav   = favLocal ? lambdaLocal : lambdaVisitante;
    const nomFav   = favLocal ? local.name  : visitante.name;
    const probFav  = (1 - Math.exp(-lamFav)) * 100;
    if (probFav >= CONFIG.UMBRAL_GOL_EQUIPO) {
      candidatos.push({
        etiqueta: `${nomFav} marca más de 0.5 goles`,
        prob:     probFav,
        sel:      favLocal ? "gl_over_0.5" : "gv_over_0.5",
        mercado:  "Goles favorito",
        motivo:   `${nomFav} es el equipo favorito y marca con ${probFav.toFixed(0)}% de probabilidad. "Marca más de 0.5 goles" (anota al menos 1) es de las líneas más fiables. Se evalúa solo con el marcador final.`
      });
    }

    /* ── 4. CÓRNERS · se mantienen (mejores cuotas). Compiten por confianza.
          Si los stats son genéricos (cf=ca=4.5) la estimación NO es fiable:
          subimos mucho el umbral y avisamos con mensaje de IA. ── */
    const statsDefaultLocal = !local.statsReales || (local.cf === 4.5 && local.ca === 4.5);
    const statsDefaultVisit = !visitante.statsReales || (visitante.cf === 4.5 && visitante.ca === 4.5);
    const datosCornersFiables = !(statsDefaultLocal || statsDefaultVisit);
    const umbralCornersEfectivo = datosCornersFiables ? CONFIG.UMBRAL_CORNERS : 88;

    const rCorners = mejorLinea(CONFIG.LINEAS_CORNERS, lambdaCorners, umbralCornersEfectivo, tipoPartido);
    if (rCorners) {
      candidatos.push({
        etiqueta: etiquetaLinea(rCorners, "córners"),
        prob:     rCorners.prob,
        mercado:  "Córners",
        motivo:   motivoCorners(rCorners, lambdaCorners, local, visitante)
      });
    }

    /* ── Ordenar: la IA compara todos los mercados y elige los más fuertes.
          Más seguras primero; ante confianza similar, prioridad de mercado.
          1 por tipo, máx 3. Córners compite de forma normal (mejores cuotas). ── */
    candidatos.sort((a, b) =>
      (Math.round(b.prob) - Math.round(a.prob)) ||
      ((PRIORIDAD[a.mercado] ?? 99) - (PRIORIDAD[b.mercado] ?? 99)) ||
      (b.prob - a.prob)
    );
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
        sel:        c.sel || "",
        motivo:     c.motivo
      };
    });

    const confianzaGeneral = pronosticos.length
      ? Math.round(pronosticos.reduce((s, p) => s + p.confianza, 0) / pronosticos.length)
      : 0;

    // ── La IA estudia el partido, redacta su conclusión y detecta riesgo ──
    const ctxIA = { lambdaLocal, lambdaVisitante, lambdaGoles, lambdaCorners, mercado, datosCornersFiables };
    const senales      = calcularSenales(local, visitante, ctxIA);
    const analisisIA    = generarRazonamiento(local, visitante, ctxIA, senales, pronosticos);
    const alertaIA      = evaluarRiesgo(local, visitante, ctxIA, senales, pronosticos);
    const cornersInfo   = (!datosCornersFiables && !pronosticos.some(p => p.mercado === "Córners"))
      ? "IA: Datos insuficientes para evaluar córners con confianza." : "";

    return {
      ...base,
      pronosticos,
      confianzaGeneral,
      hayValor:       pronosticos.length > 0,
      sinDatos:       false,
      analisisIA,
      alertaIA,
      cornersInfo,
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

  function lineaDeSel(sel) {
    const m = String(sel || "").match(/(\d+(?:\.\d+)?)\s*$/);
    return m ? parseFloat(m[1]) : NaN;
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
      const s = pr.sel || "";
      if (s === "1X" || texto.includes("(1X)")) return (gl >= gv) ? "acertado" : "fallado";
      if (s === "X2" || texto.includes("(X2)")) return (gv >= gl) ? "acertado" : "fallado";
      if (s === "12" || texto.includes("(12)")) return (gl !== gv) ? "acertado" : "fallado";
    }

    // Equipo favorito marca +0.5 (anota al menos 1). sel = gl_over_0.5 / gv_over_0.5
    if (pr.mercado === "Goles favorito") {
      const esLocalFav = String(pr.sel || "").startsWith("gl_");
      const goles = esLocalFav ? gl : gv;
      if (!Number.isFinite(goles)) return "pendiente";
      const linea = Number.isFinite(lineaDeSel(pr.sel)) ? lineaDeSel(pr.sel) : 0.5;
      return goles > linea ? "acertado" : "fallado";
    }

    /* ── Mercados que se resuelven SOLO con el marcador final ── */
    if (pr.mercado === "Ambos anotan") {
      if (!Number.isFinite(gl) || !Number.isFinite(gv)) return "pendiente";
      const ambosMarcan = gl >= 1 && gv >= 1;
      const quiereSi = pr.sel ? pr.sel === "btts_si" : /:\s*s[íi]\b/i.test(texto);
      return (quiereSi === ambosMarcan) ? "acertado" : "fallado";
    }

    if (pr.mercado === "Goles local") {
      if (!Number.isFinite(gl)) return "pendiente";
      const linea = Number.isFinite(lineaDeSel(pr.sel)) ? lineaDeSel(pr.sel) : lineaDeTexto(texto);
      if (!Number.isFinite(linea)) return "pendiente";
      return gl > linea ? "acertado" : "fallado";
    }

    if (pr.mercado === "Goles visitante") {
      if (!Number.isFinite(gv)) return "pendiente";
      const linea = Number.isFinite(lineaDeSel(pr.sel)) ? lineaDeSel(pr.sel) : lineaDeTexto(texto);
      if (!Number.isFinite(linea)) return "pendiente";
      return gv > linea ? "acertado" : "fallado";
    }

    if (pr.mercado === "Resultado") {
      if (!Number.isFinite(gl) || !Number.isFinite(gv)) return "pendiente";
      const s = pr.sel
        || (texto.includes("(1)") ? "res_local"
          : texto.includes("(2)") ? "res_visita"
          : texto.includes("(X)") ? "res_empate" : "");
      if (s === "res_local")  return gl >  gv ? "acertado" : "fallado";
      if (s === "res_empate") return gl === gv ? "acertado" : "fallado";
      if (s === "res_visita") return gv >  gl ? "acertado" : "fallado";
      return "pendiente";
    }

    if (pr.mercado === "No empate") {
      if (!Number.isFinite(gl) || !Number.isFinite(gv)) return "pendiente";
      return gl !== gv ? "acertado" : "fallado";
    }

    return "pendiente";
  }

  function evaluarCombinada(pronosticos, partido) {
    if (partido.enVivo) return "vivo";
    if (!pronosticos || !pronosticos.length) return "pendiente";
    const evaluados = pronosticos.map(pr => ({
      mercado: pr.mercado,
      estado: evaluarPronostico(pr, partido)
    }));
    const evaluables = evaluados.filter(x => {
      if (x.mercado === "Córners" && x.estado === "pendiente") return false;
      return x.estado !== "pendiente";
    });
    if (!evaluables.length) return "pendiente";
    if (evaluables.some(x => x.estado === "fallado")) return "fallado";
    if (evaluables.every(x => x.estado === "acertado")) return "acertado";
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
