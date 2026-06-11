/* =====================================================================
   ROPROST PREDICT — INTERFAZ Y ARRANQUE  (app-main.js)
   ===================================================================== */

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const state = { analizados: [], seguimiento: [], dia: "manana", fecha: "" };

  function colorConfianza(pct) {
    if (pct >= 90) return "var(--c-exc)";
    if (pct >= 85) return "var(--c-alta)";
    if (pct >= 80) return "var(--c-buena)";
    if (pct >= 75) return "var(--c-ok)";
    return "var(--c-baja)";
  }

  function chip(pct) {
    return `<span class="chip" style="--chip:${colorConfianza(pct)}">${pct}%</span>`;
  }

  function etiquetaDia(dia) { return dia === "hoy" ? "hoy" : "mañana"; }
  function tituloDia(dia) { return dia === "hoy" ? "Hoy" : "Mañana"; }

  function logo(src, nombre) {
    return src ? `<img class="team-logo" src="${src}" alt="${nombre}" loading="lazy">` : `<span class="team-logo team-logo-fallback">${(nombre || "?").slice(0,1)}</span>`;
  }

  function renderSinPartidos(dia = "manana", fecha = "", error = null) {
    const diaTexto = etiquetaDia(dia);
    return `<section class="bloque">
      <h2 class="bloque-titulo"><span class="eyebrow">Datos reales</span>Partidos de ${diaTexto}${fecha ? ` · ${fecha}` : ""}</h2>
      <p class="vacio">⚠️ No se encontraron partidos reales para ${diaTexto} en la API.</p>
      ${error ? `<p class="vacio">Detalle técnico: ${error}</p>` : ``}
    </section>`;
  }

  function renderPicks(picks, dia = "manana") {
    const diaTexto = etiquetaDia(dia);
    const diaTitulo = tituloDia(dia);
    if (!picks.length) {
      return `<section class="bloque">
        <h2 class="bloque-titulo"><span class="eyebrow">Lo más exigente</span>Picks de ${diaTitulo}</h2>
        <p class="vacio">⚠️ Para ${diaTexto} no hay picks que superen el 80% de confianza. No forzamos recomendaciones.</p>
      </section>`;
    }
    const items = picks.map((p, i) => `
      <article class="pick">
        <div class="pick-num">#${i + 1}</div>
        <div class="pick-body">
          <div class="pick-top"><span class="pick-liga">${p.liga}</span>${chip(p.confianza)}</div>
          <h3 class="pick-partido">${p.partido}</h3>
          <div class="pick-pron">${p.etiqueta}</div>
          <p class="pick-motivo">${p.motivo}</p>
        </div>
      </article>`).join("");
    return `<section class="bloque">
      <h2 class="bloque-titulo"><span class="eyebrow">Lo más exigente · mín. 80%</span>Picks de ${diaTitulo}</h2>
      <div class="picks-grid">${items}</div>
    </section>`;
  }

  function renderTop(bets, dia = "manana") {
    const diaTexto = etiquetaDia(dia);
    if (!bets.length) {
      return `<section class="bloque">
        <h2 class="bloque-titulo"><span class="eyebrow">Ranking de ${diaTexto}</span>Top Apuestas</h2>
        <p class="vacio">No se encontraron apuestas suficientemente seguras para ${diaTexto}.</p>
      </section>`;
    }
    const filas = bets.map((b, i) => `
      <li class="top-fila">
        <span class="top-rank">${i + 1}</span>
        <div class="top-info"><span class="top-pron">${b.etiqueta}</span><span class="top-partido">${b.partido} · ${b.liga}</span></div>
        ${chip(b.confianza)}
      </li>`).join("");
    return `<section class="bloque">
      <h2 class="bloque-titulo"><span class="eyebrow">Ranking de ${diaTexto} · de la más segura a la menos</span>Top Apuestas</h2>
      <ul class="top-lista">${filas}</ul>
    </section>`;
  }

  function renderFiltros(partidos) {
    const ligas = [...new Set(partidos.map(p => p.liga || "Sin liga"))].sort();
    return `<section class="bloque filtros-bloque">
      <h2 class="bloque-titulo"><span class="eyebrow">Buscar y filtrar</span>Explorar partidos</h2>
      <div class="filtros">
        <input id="buscador-partidos" class="filtro-input" type="search" placeholder="Buscar equipo o liga...">
        <select id="filtro-liga" class="filtro-select">
          <option value="">Todas las ligas</option>
          ${ligas.map(l => `<option value="${l}">${l}</option>`).join("")}
        </select>
      </div>
    </section>`;
  }

  function renderProbabilidades(p) {
    const pv = p.probVictoria || {};
    return `<div class="prob-box">
      <div><span>${p.local.name}</span><strong>${pv.local ?? 0}%</strong></div>
      <div><span>Empate</span><strong>${pv.empate ?? 0}%</strong></div>
      <div><span>${p.visitante.name}</span><strong>${pv.visitante ?? 0}%</strong></div>
    </div>`;
  }

  function renderUltimos(nombre, ultimos = []) {
    if (!ultimos.length) return `<div class="ultimos-equipo"><strong>${nombre}</strong><span class="muted">Sin últimos partidos disponibles en la API.</span></div>`;
    return `<div class="ultimos-equipo"><strong>${nombre}</strong>${ultimos.map(u => `<span>${u.fecha} · ${u.local} ${u.marcador} ${u.visitante}</span>`).join("")}</div>`;
  }

  function cardPartido(p, fecha = "") {
    const idoneo = p.hayValor;
    const detalle = idoneo
      ? p.pronosticos.map(pr => `
          <div class="pron">
            <span class="pron-check">✅</span>
            <span class="pron-text">${pr.etiqueta}<small class="riesgo ${pr.riesgoClase || ""}">${pr.riesgo || pr.nivel}</small></span>
            ${chip(pr.confianza)}
          </div>`).join("")
      : `<p class="vacio">⚠️ No se encontraron pronósticos suficientemente seguros para este partido.</p>`;

    return `
    <article class="match" data-id="${p.id}">
      <button class="match-head" aria-expanded="false">
        <div class="match-meta"><span class="match-liga">${p.liga}</span><span class="match-hora">${p.fecha || fecha} · ${p.hora}</span></div>
        <div class="match-teams"><span class="team-line">${logo(p.local.logo, p.local.name)}${p.local.name}</span><span class="vs">vs</span><span class="team-line">${logo(p.visitante.logo, p.visitante.name)}${p.visitante.name}</span></div>
        <div class="match-conf"><span class="match-conf-label">Confianza IA</span>${idoneo ? chip(p.confianzaGeneral) : `<span class="chip chip-off">—</span>`}<span class="caret">▾</span></div>
      </button>
      <div class="match-body">
        <div class="match-tag">${p.tipoPartido === "ABIERTO" ? "🔥 Partido abierto" : p.tipoPartido === "CERRADO" ? "🛡️ Partido cerrado" : "⚖️ Partido equilibrado"}</div>
        ${renderProbabilidades(p)}
        ${detalle}
        <div class="ultimos-grid">${renderUltimos(p.local.name, p.local.ultimos)}${renderUltimos(p.visitante.name, p.visitante.ultimos)}</div>
      </div>
    </article>`;
  }

  function renderPartidos(partidos, dia = "manana", fecha = "") {
    const diaTexto = etiquetaDia(dia);
    const ordenados = [...partidos].sort((a, b) => {
      const ligaA = (a.liga || "Sin liga").localeCompare(b.liga || "Sin liga");
      if (ligaA !== 0) return ligaA;
      return String(a.hora || "").localeCompare(String(b.hora || ""));
    });
    const grupos = ordenados.reduce((acc, p) => {
      const liga = p.liga || "Sin liga";
      if (!acc[liga]) acc[liga] = [];
      acc[liga].push(p);
      return acc;
    }, {});
    const bloquesLiga = Object.keys(grupos).map((liga, index) => {
      const total = grupos[liga].length;
      return `<div class="liga-grupo ${index === 0 ? "open" : ""}">
        <button class="liga-head" aria-expanded="${index === 0 ? "true" : "false"}">
          <span class="liga-nombre">${liga}</span><span class="liga-cantidad">${total} partido${total === 1 ? "" : "s"}</span><span class="liga-caret">▾</span>
        </button>
        <div class="liga-body"><div class="matches">${grupos[liga].map(p => cardPartido(p, fecha)).join("")}</div></div>
      </div>`;
    }).join("");
    return `<section class="bloque" id="bloque-partidos">
      <h2 class="bloque-titulo"><span class="eyebrow">Todos los partidos</span>Partidos de ${diaTexto}${fecha ? ` · ${fecha}` : ""}</h2>
      ${bloquesLiga || `<p class="vacio">No hay partidos con ese filtro.</p>`}
    </section>`;
  }

  function renderSeguimiento(seguimiento = []) {
    if (!seguimiento.length) {
      return `<section class="bloque"><h2 class="bloque-titulo"><span class="eyebrow">Historial y vivo</span>Resultados / En vivo</h2><p class="vacio">Aún no hay partidos en vivo o finalizados recientes disponibles en la API.</p></section>`;
    }

    const analizados = RoprostEngine.analizarTodos(seguimiento);
    let ganados = 0, perdidos = 0, vivos = 0;

    const rows = analizados.slice(0, 20).map(p => {
      const pr = p.pronosticos[0];
      const estado = p.enVivo ? "vivo" : (pr ? RoprostEngine.evaluarPronostico(pr, p) : "pendiente");
      if (estado === "acertado") ganados++;
      if (estado === "fallado") perdidos++;
      if (estado === "vivo") vivos++;
      const marcador = (p.golesLocal !== "" && p.golesVisitante !== "" && p.golesLocal !== undefined && p.golesVisitante !== undefined) ? `${p.golesLocal}-${p.golesVisitante}` : "vs";
      const label = estado === "acertado" ? "Acertado" : estado === "fallado" ? "Fallado" : estado === "vivo" ? "En vivo" : "Pendiente";
      return `<li class="resultado ${estado}">
        <div><strong>${p.local.name} ${marcador} ${p.visitante.name}</strong><span>${p.liga} · ${p.fecha} · ${p.hora}</span></div>
        <div><span>${pr ? pr.etiqueta : "Sin pick evaluable"}</span><b>${label}</b></div>
      </li>`;
    }).join("");

    const total = ganados + perdidos;
    const precision = total ? Math.round((ganados / total) * 100) : 0;

    return `<section class="bloque"><h2 class="bloque-titulo"><span class="eyebrow">Historial y vivo</span>Resultados / En vivo</h2>
      <div class="historial-resumen">
        <div><strong>${ganados}</strong><span>Ganados</span></div>
        <div><strong>${perdidos}</strong><span>Perdidos</span></div>
        <div><strong>${vivos}</strong><span>En vivo</span></div>
        <div><strong>${precision}%</strong><span>Precisión</span></div>
      </div>
      <ul class="resultados-lista">${rows}</ul>
    </section>`;
  }

  function aplicarFiltros() {
    const q = ($("#buscador-partidos")?.value || "").toLowerCase().trim();
    const liga = $("#filtro-liga")?.value || "";
    const filtrados = state.analizados.filter(p => {
      const texto = `${p.liga} ${p.local.name} ${p.visitante.name}`.toLowerCase();
      return (!q || texto.includes(q)) && (!liga || p.liga === liga);
    });
    const cont = $("#bloque-partidos");
    if (cont) { cont.outerHTML = renderPartidos(filtrados, state.dia, state.fecha); activarAcordeon(); }
  }

  function activarAcordeon() {
    document.querySelectorAll(".liga-head").forEach(btn => {
      btn.onclick = () => { const grupo = btn.closest(".liga-grupo"); const abierto = grupo.classList.toggle("open"); btn.setAttribute("aria-expanded", abierto); };
    });
    document.querySelectorAll(".match-head").forEach(btn => {
      btn.onclick = () => { const card = btn.closest(".match"); const abierto = card.classList.toggle("open"); btn.setAttribute("aria-expanded", abierto); };
    });
    $("#buscador-partidos")?.addEventListener("input", aplicarFiltros);
    $("#filtro-liga")?.addEventListener("change", aplicarFiltros);
  }

  async function init() {
    const app = $("#app");
    app.innerHTML = `<div class="loading">Analizando partidos de mañana…</div>`;
    const { partidos, seguimiento, finalizados, dia, fecha, error } = await RoprostData.obtenerPartidos();
    state.dia = dia;
    state.fecha = fecha;
    state.seguimiento = seguimiento || finalizados || [];
    const diaTexto = etiquetaDia(dia);

    if (!partidos.length) {
      app.innerHTML = `<header class="hero"><div class="brand"><span class="brand-dot"></span><h1>Roprost <span>Predict</span></h1></div><p class="hero-sub">Análisis selectivo de partidos de ${diaTexto}. Pocas apuestas, máxima probabilidad real.</p></header>${renderSinPartidos(dia, fecha, error)}${renderSeguimiento(state.seguimiento)}<footer class="pie"><p>Las cifras son <strong>probabilidades estimadas</strong>, no garantías de acierto.</p><p class="pie-juego">Juega con responsabilidad · +18 · El juego puede generar adicción.</p></footer>`;
      return;
    }

    state.analizados = RoprostEngine.analizarTodos(partidos);
    const picks = RoprostEngine.picksDelDia(state.analizados);
    const top = RoprostEngine.topApuestas(state.analizados);

    app.innerHTML = `<header class="hero"><div class="brand"><span class="brand-dot"></span><h1>Roprost <span>Predict</span></h1></div><p class="hero-sub">Análisis selectivo de partidos de ${diaTexto}. Pocas apuestas, máxima probabilidad real.</p></header>${renderPicks(picks, dia)}${renderTop(top, dia)}${renderFiltros(state.analizados)}${renderPartidos(state.analizados, dia, fecha)}${renderSeguimiento(state.seguimiento)}<footer class="pie"><p>Las cifras son <strong>probabilidades estimadas</strong> por un modelo estadístico (Poisson), no garantías de acierto.</p><p class="pie-juego">Juega con responsabilidad · +18 · El juego puede generar adicción.</p></footer>`;
    activarAcordeon();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
