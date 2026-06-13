/* =====================================================================
   ROPROST PREDICT — RUNNER DE CÓRNERS REALES
   Solo consulta API-Sports cuando:
   1) El partido está finalizado o ya tiene marcador real.
   2) Tiene pronóstico de córners.
   3) Todavía no tiene córners guardados.
   ===================================================================== */

const RoprostCornersRunner = (() => {
  "use strict";

  function esNumeroValido(v) {
    if (v === null || v === undefined || v === "") return false;
    return Number.isFinite(Number(v));
  }

  function tieneMarcadorReal(partido) {
    return esNumeroValido(partido?.golesLocal) &&
           esNumeroValido(partido?.golesVisitante);
  }

  function tieneCornersGuardados(partido) {
    return esNumeroValido(partido?.cornersLocal) &&
           esNumeroValido(partido?.cornersVisitante);
  }

  function tienePickCorners(partido) {
    return (partido?.pronosticos || []).some(p => {
      const txt = `${p.mercado || ""} ${p.etiqueta || ""}`.toLowerCase();
      return txt.includes("corner") || txt.includes("córner") || txt.includes("córners");
    });
  }

  async function completarPartido(partido) {
    if (!partido) return partido;

    const marcadorReal = tieneMarcadorReal(partido);

    if (marcadorReal) {
      partido.finalizado = true;
      partido.enVivo = false;
    }

    if (!partido.finalizado && !marcadorReal) return partido;
    if (!tienePickCorners(partido)) return partido;
    if (tieneCornersGuardados(partido)) return partido;
    if (!window.RoprostCornersAPI?.obtenerCorners) return partido;

    try {
      const corners = await window.RoprostCornersAPI.obtenerCorners(partido);

      if (
        corners &&
        esNumeroValido(corners.home) &&
        esNumeroValido(corners.away)
      ) {
        partido.cornersLocal = Number(corners.home);
        partido.cornersVisitante = Number(corners.away);
        partido.cornersTotales = Number(corners.home) + Number(corners.away);
        partido.cornersFuente = "API-Sports";
      }
    } catch (e) {
      console.warn("No se pudieron completar córners reales:", e);
    }

    return partido;
  }

  async function completarLista(partidos = []) {
    const salida = [];

    for (const partido of partidos) {
      salida.push(await completarPartido(partido));
    }

    return salida;
  }

  return {
    completarPartido,
    completarLista
  };
})();

window.RoprostCornersRunner = RoprostCornersRunner;
