/* =====================================================================
   ROPROST PREDICT — INTERFAZ Y ARRANQUE  (app-main.js)
   ===================================================================== */

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const state = { analizadosHoy: [], analizadosManana: [], seguimiento: [], fechaHoy: "", fechaManana: "" };

  /* =====================================================================
     HISTORIAL PERSISTENTE (24 h)
     ===================================================================== */
  const Hist = (() => {
    const KEY = "rp_hist24_v1";
    const TTL = 24 * 60 * 60 * 1000;
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
    const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} };

    function purge(o) {
      const now = Date.now(); let changed = false;
      for (const k of Object.keys(o)) { if (now - (o[k].ts || 0) > TTL) { delete o[k]; changed = true; } }
      if (changed) save(o);
      return o;
    }

    function snapshotPredicciones(analizados) {
      const o = purge(load());
      analizados.forEach(p => {
        if (!p.id || !p.hayValor) return;
        const prev = o[p.id] || {};
        o[p.id] = { ...prev, ts: prev.ts || Date.now(), id: p.id, liga: p.liga, fecha: p.fecha, hora: p.hora,
          local: { name: p.local.name, logo: p.local.logo }, visitante: { name: p.visitante.name, logo: p.visitante.logo },
          tipoPartido: p.tipoPartido, pronosticos: p.pronosticos,
          golesLocal: prev.golesLocal, golesVisitante: prev.golesVisitante,
          cornersLocal: prev.cornersLocal, cornersVisitante: prev.cornersVisitante,
          enVivo: prev.enVivo || false, finalizado: prev.finalizado || false };
      });
      save(o); return o;
    }

    function actualizarResultados(seguimiento) {
      const o = purge(load());
      seguimiento.forEach(s => {
        if (!s.id) return;
        let e = o[s.id];
        if (!e) {
          const an = RoprostEngine.analizarPartido(s);
          if (!an.hayValor) return;
          e = { ts: Date.now(), id: s.id, liga: s.liga, fecha: s.fecha, hora: s.hora,
            local: { name: s.local.name, logo: s.local.logo }, visitante: { name: s.visitante.name, logo: s.visitante.logo },
            tipoPartido: an.tipoPartido, pronosticos: an.pronosticos };
        }
        e.golesLocal = s.golesLocal; e.golesVisitante = s.golesVisitante;
        e.cornersLocal = s.cornersLocal; e.cornersVisitante = s.cornersVisitante;
        e.enVivo = s.enVivo; e.finalizado = s.finalizado;
        o[s.id] = e;
      });
      save(o); return o;
    }

    function entradasVisibles() {
      const o = purge(load());
      return Object.values(o)
        .filter(e => (e.enVivo || e.finalizado) && e.pronosticos && e.pronosticos.length)
        .sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`));
    }

    function todasConProns() {
      const o = purge(load());
      return Object.values(o)
        .filter(e => e.pronosticos && e.pronosticos.length)
        .sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`));
    }

    return { snapshotPredicciones, actualizarResultados, entradasVisibles, todasConProns };
  })();

  /* ── Helpers visuales ─────────────────────────────────────────────── */
  function colorConfianza(pct) {
    if (pct >= 90) return "var(--c-exc)";
    if (pct >= 85) return "var(--c-alta)";
    if (pct >= 80) return "var(--c-buena)";
    if (pct >= 75) return "var(--c-ok)";
    return "var(--c-baja)";
  }
  function chip(pct) { return `<span class="chip" style="--chip:${colorConfianza(pct)}">${pct}%</span>`; }
  function logo(src, nombre) {
    return src
      ? `<img class="team-logo" src="${src}" alt="${nombre}" loading="lazy">`
      : `<span class="team-logo team-logo-fallback">${(nombre || "?").slice(0,1)}</span>`;
  }

  /* ── Sin partidos ─────────────────────────────────────────────────── */
  function renderSinPartidos(dia, fecha, error) {
    const txt = dia === "hoy" ? "hoy" : "mañana";
    return `<section class="bloque">
      <h2 class="bloque-titulo"><span class="eyebrow">Datos reales</span>Partidos de ${txt}${fecha ? ` · ${fecha}` : ""}</h2>
      <p class="vacio">⚠️ No se encontraron partidos para ${txt} en la API.</p>
      ${error ? `<p class="vacio">Detalle: ${error}</p>` : ""}
    </section>`;
  }

  /* ── Picks ────────────────────────────────────────────────────────── */
  function renderPicks(picks) {
    if (!picks.length) return `<section class="bloque"><h2 class="bloque-titulo"><span class="eyebrow">Lo más exigente</span>Picks de mañana</h2><p class="vacio">⚠️ No hay picks que superen el 85% de confianza para mañana. No forzamos recomendaciones.</p></section>`;
    const items = picks.map((p, i) => `<article class="pick"><div class="pick-num">#${i + 1}</div><div class="pick-body"><div class="pick-top"><span class="pick-liga">${p.liga}</span>${chip(p.confianza)}</div><h3 class="pick-partido">${p.partido}</h3><div class="pick-pron">${p.etiqueta}</div><p class="pick-motivo">${p.motivo}</p></div></article>`).join("");
    return `<section class="bloque"><h2 class="bloque-titulo"><span class="eyebrow">Lo más exigente · mín. 85%</span>Picks de mañana</h2><div class="picks-grid">${items}</div></section>`;
  }

  /* ── Top ──────────────────────────────────────────────────────────── */
  function renderTop(bets) {
    if (!bets.length) return `<section class="bloque"><h2 class="bloque-titulo"><span class="eyebrow">Ranking de mañana</span>Top Apuestas</h2><p class="vacio">No se encontraron apuestas suficientemente seguras para mañana.</p></section>`;
    const filas = bets.map((b, i) => `<li class="top-fila"><span class="top-rank">${i + 1}</span><div class="top-info"><span class="top-pron">${b.etiqueta}</span><span class="top-partido">${b.partido} · ${b.liga}</span></div>${chip(b.confianza)}</li>`).join("");
    return `<section class="bloque"><h2 class="bloque-titulo"><span class="eyebrow">Ranking de mañana · de la más segura a la menos</span>Top Apuestas</h2><ul class="top-lista">${filas}</ul></section>`;
  }

  /* ── Filtros ──────────────────────────────────────────────────────── */
  function renderFiltros(partidos, sfx) {
    const ligas = [...new Set(partidos.map(p => p.liga || "Sin liga"))].sort();
    return `<section class="bloque filtros-bloque"><h2 class="bloque-titulo"><span class="eyebrow">Buscar y filtrar</span>Explorar partidos</h2><div class="filtros"><input id="buscador${sfx}" class="filtro-input" type="search" placeholder="Buscar equipo o liga..."><select id="filtroliga${sfx}" class="filtro-select"><option value="">Todas las ligas</option>${ligas.map(l => `<option value="${l}">${l}</option>`).join("")}</select></div></section>`;
  }

  /* ── Probabilidades ───────────────────────────────────────────────── */
  function renderProbabilidades(p) {
    const pv = p.probVictoria || {};
    return `<div class="prob-box"><div><span>${p.local.name}</span><strong>${pv.local ?? 0}%</strong></div><div><span>Empate</span><strong>${pv.empate ?? 0}%</strong></div><div><span>${p.visitante.name}</span><strong>${pv.visitante ?? 0}%</strong></div></div>`;
  }

  function renderUltimos(nombre, ultimos = []) {
    if (!ultimos.length) return `<div class="ultimos-equipo"><strong>${nombre}</strong><span class="muted">Sin últimos partidos disponibles.</span></div>`;
    return `<div class="ultimos-equipo"><strong>${nombre}</strong>${ultimos.map(u => `<span>${u.fecha} · ${u.local} ${u.marcador} ${u.visitante}</span>`).join("")}</div>`;
  }

  /* ── Card de partido ──────────────────────────────────────────────── */
  function cardPartido(p) {
    const idoneo = p.hayValor;
    const motivoEstilo = "display:block;margin-top:4px;font-size:11.5px;line-height:1.5;color:var(--txt-faint)";
    const detalle = idoneo
      ? p.pronosticos.map(pr => `<div class="pron"><span class="pron-check">✅</span><span class="pron-text">${pr.etiqueta}<small class="riesgo ${pr.riesgoClase || ""}">${pr.riesgo || pr.nivel}</small>${pr.motivo ? `<small style="${motivoEstilo}">${pr.motivo}</small>` : ""}</span>${chip(pr.confianza)}</div>`).join("")
      : `<p class="vacio">${p.sinDatos ? "🔒 Sin pick seguro" : "⚠️ Sin pick seguro"} · ${p.motivoGeneral || "No hay líneas que superen el umbral de confianza."}</p>`;
    return `<article class="match" data-id="${p.id}"><button class="match-head" aria-expanded="false"><div class="match-meta"><span class="match-liga">${p.liga}</span><span class="match-hora">${p.fecha} · ${p.hora}</span></div><div class="match-teams"><span class="team-line">${logo(p.local.logo, p.local.name)}${p.local.name}</span><span class="vs">vs</span><span class="team-line">${logo(p.visitante.logo, p.visitante.name)}${p.visitante.name}</span></div><div class="match-conf"><span class="match-conf-label">Confianza IA</span>${idoneo ? chip(p.confianzaGeneral) : `<span class="chip chip-off">—</span>`}<span class="caret">▾</span></div></button><div class="match-body"><div class="match-tag">${p.tipoPartido === "ABIERTO" ? "🔥 Partido abierto" : p.tipoPartido === "CERRADO" ? "🛡️ Partido cerrado" : "⚖️ Partido equilibrado"}</div>${renderProbabilidades(p)}${detalle}<div class="ultimos-grid">${renderUltimos(p.local.name, p.local.ultimos)}${renderUltimos(p.visitante.name, p.visitante.ultimos)}</div></div></article>`;
  }

  /* ── Lista de partidos ────────────────────────────────────────────── */
  function renderListaPartidos(partidos, dia, fecha, sfx) {
    const txt = dia === "hoy" ? "hoy" : "mañana";
    if (!partidos.length) return renderSinPartidos(dia, fecha);
    const ordenados = [...partidos].sort((a, b) => { const l = (a.liga || "").localeCompare(b.liga || ""); return l !== 0 ? l : String(a.hora || "").localeCompare(String(b.hora || "")); });
    const grupos = ordenados.reduce((acc, p) => { const g = p.liga || "Sin liga"; if (!acc[g]) acc[g] = []; acc[g].push(p); return acc; }, {});
    const bloques = Object.keys(grupos).map((liga, i) => {
      const total = grupos[liga].length;
      return `<div class="liga-grupo ${i === 0 ? "open" : ""}"><button class="liga-head" aria-expanded="${i === 0}"><span class="liga-nombre">${liga}</span><span class="liga-cantidad">${total} partido${total === 1 ? "" : "s"}</span><span class="liga-caret">▾</span></button><div class="liga-body"><div class="matches">${grupos[liga].map(p => cardPartido(p)).join("")}</div></div></div>`;
    }).join("");
    return `<section class="bloque" id="bloque${sfx}"><h2 class="bloque-titulo"><span class="eyebrow">Todos los partidos</span>Partidos de ${txt}${fecha ? ` · ${fecha}` : ""}</h2>${bloques}</section>`;
  }

  /* ── Resultados ───────────────────────────────────────────────────── */
  function estadoTexto(e) {
    if (e === "acertado") return "Ganado"; if (e === "fallado") return "Perdido";
    if (e === "vivo") return "En vivo"; return "Pendiente";
  }

  function renderSeguimiento(entradas) {
    const mostrar = entradas.length > 0 ? entradas : Hist.todasConProns();
    if (!mostrar.length) return `<section class="bloque"><h2 class="bloque-titulo"><span class="eyebrow">Historial y vivo · últimas 24 h</span>Resultados / En vivo</h2><p class="vacio">Los pronósticos guardados aparecerán aquí en cuanto los partidos empiecen o finalicen. Se conservan 24 horas.</p></section>`;

    let ganados = 0, perdidos = 0, vivos = 0, pendientes = 0;
    const rows = mostrar.slice(0, 30).map((p, idx) => {
      const tieneMarcador = p.golesLocal !== "" && p.golesVisitante !== "" && p.golesLocal !== undefined && p.golesVisitante !== undefined;
      const estadoComb = p.finalizado ? RoprostEngine.evaluarCombinada(p.pronosticos, p) : p.enVivo ? "vivo" : "pendiente";
      if (estadoComb === "acertado") ganados++; else if (estadoComb === "fallado") perdidos++;
      else if (estadoComb === "vivo") vivos++; else pendientes++;
      const marcador = tieneMarcador ? `${p.golesLocal}-${p.golesVisitante}` : "vs";
      const prons = p.pronosticos && p.pronosticos.length ? p.pronosticos : [];
      const detalle = prons.length
        ? prons.map(pr => { const ePr = p.finalizado ? RoprostEngine.evaluarPronostico(pr, p) : p.enVivo ? "vivo" : "pendiente"; const etiq = (ePr === "pendiente" && pr.mercado === "Córners") ? "No evaluable" : estadoTexto(ePr); return `<div class="historial-pron ${ePr}"><span>${pr.etiqueta}</span><b>${etiq}</b></div>`; }).join("")
        : `<div class="historial-pron pendiente"><span>Sin pronósticos evaluables</span><b>Pendiente</b></div>`;
      const etiqCard = p.enVivo ? "🔴 En vivo" : p.finalizado ? estadoTexto(estadoComb) : `⏳ ${p.hora || "Pendiente"}`;
      return `<article class="historial-card ${estadoComb} ${idx === 0 ? "open" : ""}"><button class="historial-head" aria-expanded="${idx === 0}"><div><strong>${p.local.name} ${marcador} ${p.visitante.name}</strong><span>${p.liga} · ${p.fecha} · ${p.hora}</span></div><b>${etiqCard}</b><span class="historial-caret">▾</span></button><div class="historial-body">${detalle}<p class="historial-nota">La apuesta completa cuenta como perdida si falla al menos un pronóstico. Los córners sin datos quedan como "No evaluable". Registro disponible 24 h.</p></div></article>`;
    }).join("");

    const total = ganados + perdidos;
    const precision = total ? Math.round((ganados / total) * 100) : null;
    return `<section class="bloque"><h2 class="bloque-titulo"><span class="eyebrow">Historial y vivo · últimas 24 h</span>Resultados / En vivo</h2><div class="historial-resumen"><div><strong>${ganados}</strong><span>✅ Ganados</span></div><div><strong>${perdidos}</strong><span>❌ Perdidos</span></div><div><strong>${vivos}</strong><span>🔴 En vivo</span></div><div><strong>${pendientes}</strong><span>⏳ Pendientes</span></div>${precision !== null ? `<div><strong>${precision}%</strong><span>Precisión</span></div>` : ""}</div><div class="historial-lista">${rows}</div></section>`;
  }

  /* ================================================================
     CUPÓN SUGERIDO
     ================================================================ */

  const MERCADOS_PERMITIDOS = ["Goles", "Córners", "Doble oportunidad"];

  /**
   * Genera hasta 5 picks con confianza ≥ 80%, máx 1 por partido,
   * solo mercados permitidos, ordenados por confianza desc.
   */
  function generarCuponSugerido(partidosAnalizados) {
    const picks = [];
    const partidosUsados = new Set();

    // Ordenar partidos por su mejor pronóstico desc
    const ordenados = [...partidosAnalizados]
      .filter(p => p.hayValor)
      .sort((a, b) => (b.pronosticos[0]?.confianza || 0) - (a.pronosticos[0]?.confianza || 0));

    for (const p of ordenados) {
      if (partidosUsados.has(p.id)) continue;

      // El mejor pronóstico del partido que sea mercado permitido y ≥ 80%
      const mejorPron = p.pronosticos.find(pr =>
        MERCADOS_PERMITIDOS.includes(pr.mercado) && pr.confianza >= 80
      );
      if (!mejorPron) continue;

      picks.push({
        matchId:   p.id,
        partido:   `${p.local.name} vs ${p.visitante.name}`,
        liga:      p.liga,
        fecha:     p.fecha,
        hora:      p.hora,
        mercado:   mejorPron.mercado,
        etiqueta:  mejorPron.etiqueta,
        confianza: mejorPron.confianza,
        nivel:     mejorPron.nivel,
        riesgo:    mejorPron.riesgo,
        riesgoClase: mejorPron.riesgoClase,
        motivo:    mejorPron.motivo || ""
      });

      partidosUsados.add(p.id);
      if (picks.length >= 5) break;
    }

    return picks.sort((a, b) => b.confianza - a.confianza);
  }

  /** Copia el cupón al portapapeles */
  async function copiarCuponSugerido(picks) {
    const lineas = [
      "🎯 CUPÓN SUGERIDO — ROPROST PREDICT",
      "━".repeat(38),
      ""
    ];
    picks.forEach((p, i) => {
      lineas.push(`${i + 1}. ${p.partido}`);
      lineas.push(`   Liga: ${p.liga}`);
      lineas.push(`   Fecha: ${p.fecha} · ${p.hora}`);
      lineas.push(`   Mercado: ${p.mercado}`);
      lineas.push(`   Pick: ${p.etiqueta}`);
      lineas.push(`   Confianza IA: ${p.confianza}%  (${p.nivel})`);
      if (p.motivo) lineas.push(`   Motivo: ${p.motivo}`);
      lineas.push("");
    });
    lineas.push("━".repeat(38));
    lineas.push("⚠️ Busca estos partidos manualmente en tu casa de apuestas.");
    lineas.push("Roprost Predict NO realiza apuestas automáticas.");
    lineas.push("Juega con responsabilidad · +18");

    const texto = lineas.join("\n");

    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch (_) {
      // Fallback para navegadores sin clipboard API
      const ta = document.createElement("textarea");
      ta.value = texto;
      ta.style.cssText = "position:fixed;top:-9999px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    }
  }

  /** Renderiza la sección del cupón */
  function renderCuponSugerido(picks) {
    // Inyectar estilos del cupón si no existen
    if (!document.getElementById("rp-cupon-styles")) {
      const s = document.createElement("style");
      s.id = "rp-cupon-styles";
      s.textContent = `
        .cupon-aviso{background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:.82rem;color:rgba(255,255,255,.7);line-height:1.6;}
        .cupon-aviso strong{color:#fbbf24;}
        .cupon-vacio{border:1px dashed rgba(255,255,255,.1);border-radius:10px;padding:28px;text-align:center;color:rgba(255,255,255,.4);font-size:.9rem;line-height:1.7;}
        .cupon-grid{display:flex;flex-direction:column;gap:12px;margin-bottom:20px;}
        .cupon-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px 18px;border-left:3px solid var(--cupon-acento,rgba(255,255,255,.2));transition:border-color .2s;}
        .cupon-card.nivel-exc   {--cupon-acento:#6ee7b7;}
        .cupon-card.nivel-alta  {--cupon-acento:#4ade80;}
        .cupon-card.nivel-buena {--cupon-acento:#facc15;}
        .cupon-card.nivel-ok    {--cupon-acento:#fb923c;}
        .cupon-card.nivel-baja  {--cupon-acento:#f87171;}
        .cupon-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;flex-wrap:wrap;}
        .cupon-num{background:rgba(255,255,255,.08);border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;flex-shrink:0;}
        .cupon-partido{font-size:1rem;font-weight:700;flex:1;}
        .cupon-chip{font-size:.8rem;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.08);white-space:nowrap;}
        .cupon-chip.exc   {color:#6ee7b7;} .cupon-chip.alta{color:#4ade80;}
        .cupon-chip.buena {color:#facc15;} .cupon-chip.ok  {color:#fb923c;}
        .cupon-chip.baja  {color:#f87171;}
        .cupon-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:.75rem;color:rgba(255,255,255,.45);margin-bottom:8px;}
        .cupon-pick{font-size:.95rem;color:#fff;margin-bottom:4px;}
        .cupon-pick strong{color:#fff;}
        .cupon-mercado{display:inline-block;font-size:.72rem;background:rgba(255,255,255,.07);border-radius:4px;padding:2px 7px;margin-right:6px;color:rgba(255,255,255,.6);}
        .cupon-riesgo{display:inline-block;font-size:.72rem;border-radius:4px;padding:2px 7px;color:rgba(255,255,255,.6);background:rgba(255,255,255,.06);}
        .cupon-motivo{font-size:.78rem;color:rgba(255,255,255,.45);line-height:1.5;margin-top:6px;}
        .cupon-actions{display:flex;gap:10px;flex-wrap:wrap;}
        .btn-copiar{display:flex;align-items:center;gap:7px;background:linear-gradient(135deg,rgba(74,222,128,.15),rgba(74,222,128,.08));border:1px solid rgba(74,222,128,.35);color:#4ade80;border-radius:8px;padding:10px 20px;font-size:.88rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s;}
        .btn-copiar:hover{background:linear-gradient(135deg,rgba(74,222,128,.25),rgba(74,222,128,.15));border-color:rgba(74,222,128,.6);}
        .btn-copiar.copiado{color:#6ee7b7;border-color:rgba(110,231,183,.5);}
        .cupon-resumen{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:10px 14px;font-size:.8rem;color:rgba(255,255,255,.5);margin-top:4px;}
        .cupon-resumen strong{color:rgba(255,255,255,.75);}
      `;
      document.head.appendChild(s);
    }

    if (!picks.length) {
      return `<section class="bloque">
        <h2 class="bloque-titulo"><span class="eyebrow">Selección automática · mín. 80%</span>Cupón Sugerido</h2>
        <div class="cupon-aviso">⚠️ <strong>Roprost Predict no realiza apuestas automáticas.</strong> Solo muestra sugerencias estadísticas para que las busques manualmente en tu casa de apuestas. Apuesta con responsabilidad. +18.</div>
        <div class="cupon-vacio">🔍 No hay cupón sugerido disponible.<br>La IA no encontró apuestas con confianza ≥ 80% para mañana.<br><span style="font-size:.78rem">Vuelve más tarde cuando se carguen los datos del día.</span></div>
      </section>`;
    }

    function nivelClass(pct) {
      if (pct >= 95) return "exc"; if (pct >= 90) return "exc";
      if (pct >= 85) return "alta"; if (pct >= 80) return "buena";
      if (pct >= 75) return "ok"; return "baja";
    }
    function cardNivelClass(pct) {
      if (pct >= 90) return "nivel-exc"; if (pct >= 85) return "nivel-alta";
      if (pct >= 80) return "nivel-buena"; if (pct >= 75) return "nivel-ok";
      return "nivel-baja";
    }

    const tarjetas = picks.map((p, i) => `
      <div class="cupon-card ${cardNivelClass(p.confianza)}">
        <div class="cupon-card-top">
          <span class="cupon-num">${i + 1}</span>
          <span class="cupon-partido">${p.partido}</span>
          <span class="cupon-chip ${nivelClass(p.confianza)}">${p.confianza}%</span>
        </div>
        <div class="cupon-meta">
          <span>🏆 ${p.liga}</span>
          <span>📅 ${p.fecha} · ${p.hora}</span>
        </div>
        <div class="cupon-pick">
          <span class="cupon-mercado">${p.mercado}</span>
          <strong>${p.etiqueta}</strong>
        </div>
        <div>
          <span class="cupon-riesgo">${p.riesgo || p.nivel}</span>
        </div>
        ${p.motivo ? `<div class="cupon-motivo">💡 ${p.motivo}</div>` : ""}
      </div>`).join("");

    const promedio = Math.round(picks.reduce((s, p) => s + p.confianza, 0) / picks.length);

    return `<section class="bloque">
      <h2 class="bloque-titulo"><span class="eyebrow">Selección automática · mín. 80%</span>Cupón Sugerido</h2>
      <div class="cupon-aviso">⚠️ <strong>Roprost Predict no realiza apuestas automáticas.</strong> Estas son sugerencias estadísticas. Búscalas manualmente en tu casa de apuestas favorita. Juega con responsabilidad · +18.</div>
      <div class="cupon-grid" id="cupon-grid">${tarjetas}</div>
      <div class="cupon-actions">
        <button class="btn-copiar" id="btn-copiar-cupon">📋 Copiar cupón</button>
      </div>
      <div class="cupon-resumen" style="margin-top:14px">
        ${picks.length} pick${picks.length > 1 ? "s" : ""} seleccionado${picks.length > 1 ? "s" : ""} · Confianza media: <strong>${promedio}%</strong>
      </div>
    </section>`;
  }

  /** Engancha el botón copiar después del render */
  function activarCupon(picks) {
    const btn = document.getElementById("btn-copiar-cupon");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const ok = await copiarCuponSugerido(picks);
      if (ok) {
        btn.textContent = "✅ ¡Cupón copiado!";
        btn.classList.add("copiado");
        setTimeout(() => { btn.textContent = "📋 Copiar cupón"; btn.classList.remove("copiado"); }, 2500);
      } else {
        btn.textContent = "❌ Error al copiar";
        setTimeout(() => { btn.textContent = "📋 Copiar cupón"; }, 2000);
      }
    });
  }

  /* ── Filtros ──────────────────────────────────────────────────────── */
  function aplicarFiltros(fuente, dia, fecha, sfx) {
    const q = ($(`#buscador${sfx}`)?.value || "").toLowerCase().trim();
    const liga = $(`#filtroliga${sfx}`)?.value || "";
    const filtrados = fuente.filter(p => { const txt = `${p.liga} ${p.local.name} ${p.visitante.name}`.toLowerCase(); return (!q || txt.includes(q)) && (!liga || p.liga === liga); });
    const cont = $(`#bloque${sfx}`);
    if (cont) { cont.outerHTML = renderListaPartidos(filtrados, dia, fecha, sfx); activarAcordeon(); engancharFiltros(fuente, dia, fecha, sfx); }
  }

  function engancharFiltros(fuente, dia, fecha, sfx) {
    $(`#buscador${sfx}`)?.addEventListener("input",   () => aplicarFiltros(fuente, dia, fecha, sfx));
    $(`#filtroliga${sfx}`)?.addEventListener("change", () => aplicarFiltros(fuente, dia, fecha, sfx));
  }

  function activarAcordeon() {
    document.querySelectorAll(".liga-head").forEach(btn => { btn.onclick = () => { const g = btn.closest(".liga-grupo"); const a = g.classList.toggle("open"); btn.setAttribute("aria-expanded", a); }; });
    document.querySelectorAll(".match-head").forEach(btn => { btn.onclick = () => { const c = btn.closest(".match"); const a = c.classList.toggle("open"); btn.setAttribute("aria-expanded", a); }; });
    document.querySelectorAll(".historial-head").forEach(btn => { btn.onclick = () => { const c = btn.closest(".historial-card"); const a = c.classList.toggle("open"); btn.setAttribute("aria-expanded", a); }; });
  }

  /* ── Layout ───────────────────────────────────────────────────────── */
  function heroHTML() {
    return `<header class="hero"><div class="brand"><span class="brand-dot"></span><h1>Roprost <span>Predict</span></h1></div><p class="hero-sub">Análisis selectivo de partidos de hoy y mañana. Pocas apuestas, máxima probabilidad real.</p></header>`;
  }

  function footerHTML() {
    return `<footer class="pie"><p>Las cifras son <strong>probabilidades estimadas</strong> por un modelo estadístico (Poisson), no garantías de acierto.</p><p class="pie-juego">Juega con responsabilidad · +18 · El juego puede generar adicción.</p></footer>`;
  }

  function construirTabs(tabs) {
    const nav = tabs.map((t, i) => `<button class="tab-btn${i === 0 ? " active" : ""}" data-tab="${t.id}" role="tab" aria-selected="${i === 0}">${t.icono ? `<span class="tab-ico">${t.icono}</span>` : ""}${t.label}</button>`).join("");
    const panels = tabs.map((t, i) => `<div class="tab-panel${i === 0 ? " active" : ""}" id="panel-${t.id}" role="tabpanel">${t.html}</div>`).join("");
    return `<nav class="tabs" role="tablist">${nav}</nav><div class="tab-panels">${panels}</div>`;
  }

  function activarTabs(cuponPicks) {
    const btns = [...document.querySelectorAll(".tab-btn")];
    btns.forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.tab;
        btns.forEach(b => { const on = b === btn; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `panel-${id}`));
        // Activar botón copiar cuando se entra al cupón
        if (id === "cupon") activarCupon(cuponPicks);
        const barra = document.querySelector(".tabs");
        if (barra) { const y = barra.getBoundingClientRect().top + window.scrollY - 4; if (window.scrollY > y) window.scrollTo({ top: y, behavior: "smooth" }); }
      };
    });
  }

  /* ── Init ─────────────────────────────────────────────────────────── */
  async function init() {
    const app = $("#app");
    app.innerHTML = `<div class="loading">Analizando partidos de hoy y mañana…</div>`;

    const { partidosHoy, partidosManana, seguimiento, fechaHoy, fechaManana, error } = await RoprostData.obtenerPartidos();

    state.fechaHoy    = fechaHoy    || "";
    state.fechaManana = fechaManana || "";
    state.seguimiento = seguimiento || [];

    state.analizadosHoy    = RoprostEngine.analizarTodos(partidosHoy    || []);
    state.analizadosManana = RoprostEngine.analizarTodos(partidosManana || []);

    Hist.snapshotPredicciones([...state.analizadosHoy, ...state.analizadosManana]);
    Hist.actualizarResultados(state.seguimiento);
    const entradasHist = Hist.entradasVisibles();

    const picks  = RoprostEngine.picksDelDia(state.analizadosManana);
    const top    = RoprostEngine.topApuestas(state.analizadosManana);

    // Cupón: picks de mañana + hoy combinados, priorizando mañana
    const cuponPicks = generarCuponSugerido([...state.analizadosManana, ...state.analizadosHoy]);

    const htmlHoy    = renderFiltros(state.analizadosHoy, "-hoy")       + renderListaPartidos(state.analizadosHoy,    "hoy",    state.fechaHoy,    "-hoy");
    const htmlManana = renderFiltros(state.analizadosManana, "-manana") + renderListaPartidos(state.analizadosManana, "manana", state.fechaManana, "-manana");

    const tabs = [
      { id: "picks",           label: "Picks",           icono: "🎯", html: renderPicks(picks) },
      { id: "top",             label: "Top",             icono: "🏆", html: renderTop(top) },
      { id: "cupon",           label: "Cupón",           icono: "🎟️", html: renderCuponSugerido(cuponPicks) },
      { id: "partidos-hoy",    label: "Partidos Hoy",    icono: "📅", html: htmlHoy },
      { id: "partidos-manana", label: "Partidos Mañana", icono: "📅", html: htmlManana },
      { id: "historial",       label: "Resultados",      icono: "📊", html: renderSeguimiento(entradasHist) }
    ];

    app.innerHTML = heroHTML() + construirTabs(tabs) + footerHTML();
    activarTabs(cuponPicks);
    activarAcordeon();
    engancharFiltros(state.analizadosHoy,    "hoy",    state.fechaHoy,    "-hoy");
    engancharFiltros(state.analizadosManana, "manana", state.fechaManana, "-manana");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
