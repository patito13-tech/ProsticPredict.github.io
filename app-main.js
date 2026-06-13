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

  if (window.RoprostCornersRunner?.completarLista) {
    state.seguimiento = await window.RoprostCornersRunner.completarLista(state.seguimiento);
  }

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
