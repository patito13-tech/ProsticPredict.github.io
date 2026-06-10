/* =====================================================================
   ROPROST PREDICT — INTERFAZ Y ARRANQUE  (app-main.js)
   ===================================================================== */

(() => {
  "use strict";

  // Color de confianza: rojo (70) -> ámbar (82) -> verde (95+)
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

  const $ = (sel) => document.querySelector(sel);

  /* ---------- Render: Picks del Día ---------- */
  function renderPicks(picks) {
    if (!picks.length) {
      return `<section class="bloque">
        <h2 class="bloque-titulo"><span class="eyebrow">Lo más exigente</span>Picks del Día</h2>
        <p class="vacio">⚠️ Hoy no hay picks que superen el 80% de confianza. No forzamos recomendaciones.</p>
      </section>`;
    }
    const items = picks.map((p, i) => `
      <article class="pick">
        <div class="pick-num">#${i + 1}</div>
        <div class="pick-body">
          <div class="pick-top">
            <span class="pick-liga">${p.liga}</span>
            ${chip(p.confianza)}
          </div>
          <h3 class="pick-partido">${p.partido}</h3>
          <div class="pick-pron">${p.etiqueta}</div>
          <p class="pick-motivo">${p.motivo}</p>
        </div>
      </article>`).join("");
    return `<section class="bloque">
      <h2 class="bloque-titulo"><span class="eyebrow">Lo más exigente · mín. 80%</span>Picks del Día</h2>
      <div class="picks-grid">${items}</div>
    </section>`;
  }

  /* ---------- Render: Top Apuestas ---------- */
  function renderTop(bets) {
    if (!bets.length) {
      return `<section class="bloque">
        <h2 class="bloque-titulo"><span class="eyebrow">Ranking del día</span>Top Apuestas</h2>
        <p class="vacio">No se encontraron apuestas suficientemente seguras hoy.</p>
      </section>`;
    }
    const filas = bets.map((b, i) => `
      <li class="top-fila">
        <span class="top-rank">${i + 1}</span>
        <div class="top-info">
          <span class="top-pron">${b.etiqueta}</span>
          <span class="top-partido">${b.partido} · ${b.liga}</span>
        </div>
        ${chip(b.confianza)}
      </li>`).join("");
    return `<section class="bloque">
      <h2 class="bloque-titulo"><span class="eyebrow">Ranking del día · de la más segura a la menos</span>Top Apuestas</h2>
      <ul class="top-lista">${filas}</ul>
    </section>`;
  }

  /* ---------- Render: lista de partidos (acordeón) ---------- */
  function renderPartidos(partidos) {
    const cards = partidos.map((p) => {
      const idoneo = p.hayValor;
      const detalle = idoneo
        ? p.pronosticos.map(pr => `
            <div class="pron">
              <span class="pron-check">✅</span>
              <span class="pron-text">${pr.etiqueta}</span>
              ${chip(pr.confianza)}
            </div>`).join("")
        : `<p class="vacio">⚠️ No se encontraron pronósticos suficientemente seguros para este partido.</p>`;

      return `
      <article class="match" data-id="${p.id}">
        <button class="match-head" aria-expanded="false">
          <div class="match-meta">
            <span class="match-liga">${p.liga}</span>
            <span class="match-hora">${p.hora}</span>
          </div>
          <div class="match-teams">
            <span>${p.local.name}</span>
            <span class="vs">vs</span>
            <span>${p.visitante.name}</span>
          </div>
          <div class="match-conf">
            <span class="match-conf-label">Confianza IA</span>
            ${idoneo ? chip(p.confianzaGeneral) : `<span class="chip chip-off">—</span>`}
            <span class="caret">▾</span>
          </div>
        </button>
        <div class="match-body">
          <div class="match-tag">${p.tipoPartido === "ABIERTO" ? "🔥 Partido abierto" : p.tipoPartido === "CERRADO" ? "🛡️ Partido cerrado" : "⚖️ Partido equilibrado"}</div>
          ${detalle}
        </div>
      </article>`;
    }).join("");

    return `<section class="bloque">
      <h2 class="bloque-titulo"><span class="eyebrow">Todos los partidos</span>Partidos de hoy</h2>
      <div class="matches">${cards}</div>
    </section>`;
  }

  /* ---------- Interacción del acordeón ---------- */
  function activarAcordeon() {
    document.querySelectorAll(".match-head").forEach(btn => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".match");
        const abierto = card.classList.toggle("open");
        btn.setAttribute("aria-expanded", abierto);
      });
    });
  }

  /* ---------- Arranque ---------- */
  async function init() {
    const app = $("#app");
    app.innerHTML = `<div class="loading">Analizando partidos…</div>`;

    const { partidos, demo } = await RoprostData.obtenerPartidos();
    const analizados = RoprostEngine.analizarTodos(partidos);
    const picks = RoprostEngine.picksDelDia(analizados);
    const top = RoprostEngine.topApuestas(analizados);

    app.innerHTML = `
      <header class="hero">
        <div class="brand">
          <span class="brand-dot"></span>
          <h1>Roprost <span>Predict</span></h1>
        </div>
        <p class="hero-sub">Análisis selectivo. Pocas apuestas, máxima probabilidad real.</p>
        ${demo ? `<div class="banner-demo">MODO DEMO · datos de ejemplo. Edita <code>roprost-live.js</code> con tu API KEY para datos reales.</div>` : ``}
      </header>
      ${renderPicks(picks)}
      ${renderTop(top)}
      ${renderPartidos(analizados)}
      <footer class="pie">
        <p>Las cifras son <strong>probabilidades estimadas</strong> por un modelo estadístico (Poisson), no garantías de acierto.</p>
        <p class="pie-juego">Juega con responsabilidad · +18 · El juego puede generar adicción.</p>
      </footer>
    `;
    activarAcordeon();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
