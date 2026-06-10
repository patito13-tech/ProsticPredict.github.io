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

  function etiquetaDia(dia) {
    return dia === "hoy" ? "hoy" : "mañana";
  }

  function tituloDia(dia) {
    return dia === "hoy" ? "Hoy" : "Mañana";
  }

  /* ---------- Render: Picks del Día ---------- */
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
      <h2 class="bloque-titulo"><span class="eyebrow">Lo más exigente · mín. 80%</span>Picks de ${diaTitulo}</h2>
      <div class="picks-grid">${items}</div>
    </section>`;
  }

  /* ---------- Render: Top Apuestas ---------- */
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
        <div class="top-info">
          <span class="top-pron">${b.etiqueta}</span>
          <span class="top-partido">${b.partido} · ${b.liga}</span>
        </div>
        ${chip(b.confianza)}
      </li>`).join("");
    return `<section class="bloque">
      <h2 class="bloque-titulo"><span class="eyebrow">Ranking de ${diaTexto} · de la más segura a la menos</span>Top Apuestas</h2>
      <ul class="top-lista">${filas}</ul>
    </section>`;
  }

  /* ---------- Render: lista de partidos (acordeón) ---------- */
  function renderPartidos(partidos, dia = "manana", fecha = "") {
    const diaTexto = etiquetaDia(dia);
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
            <span class="match-hora">${p.fecha || fecha} · ${p.hora}</span>
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
      <h2 class="bloque-titulo"><span class="eyebrow">Todos los partidos</span>Partidos de ${diaTexto}${fecha ? ` · ${fecha}` : ""}</h2>
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
    app.innerHTML = `<div class="loading">Analizando partidos de mañana…</div>`;

    const { partidos, demo, dia, fecha } = await RoprostData.obtenerPartidos();
    const analizados = RoprostEngine.analizarTodos(partidos);
    const picks = RoprostEngine.picksDelDia(analizados);
    const top = RoprostEngine.topApuestas(analizados);
    const diaTexto = etiquetaDia(dia);

    app.innerHTML = `
      <header class="hero">
        <div class="brand">
          <span class="brand-dot"></span>
          <h1>Roprost <span>Predict</span></h1>
        </div>
        <p class="hero-sub">Análisis selectivo de partidos de ${diaTexto}. Pocas apuestas, máxima probabilidad real.</p>
        ${demo ? `<div class="banner-demo">MODO DEMO · no se encontraron datos reales para ${diaTexto}. Revisa tu API KEY o disponibilidad de APIfootball.</div>` : ``}
      </header>
      ${renderPicks(picks, dia)}
      ${renderTop(top, dia)}
      ${renderPartidos(analizados, dia, fecha)}
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
