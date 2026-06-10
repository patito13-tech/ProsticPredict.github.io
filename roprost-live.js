/* =====================================================================
   ROPROST PREDICT — CAPA DE DATOS REALES (roprost-live.js)
   ---------------------------------------------------------------------
   Conexión preparada para APIfootball (apiv3.apifootball.com).
   ===================================================================== */

const RoprostData = (() => {

  const CONFIG = {
    API_KEY: "e202c0f5eebf36c56ec54c296fffe77587457afb2c8f2cf3bb216ca2578938d3",
    API_HOST: "https://apiv3.apifootball.com/",

    // Vacío = trae todos los partidos disponibles de la fecha consultada.
    LIGAS: [],

    // Opciones: "hoy" o "manana".
    DIA_OBJETIVO: "manana",

    // IMPORTANTE: false = no inventa partidos.
    USAR_DEMO: false
  };

  function fechaPeru(offsetDias = 0) {
    const ahora = new Date();
    const peru = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Lima" }));
    peru.setDate(peru.getDate() + offsetDias);
    const yyyy = peru.getFullYear();
    const mm = String(peru.getMonth() + 1).padStart(2, "0");
    const dd = String(peru.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function fechaObjetivo() {
    return CONFIG.DIA_OBJETIVO === "hoy" ? fechaPeru(0) : fechaPeru(1);
  }

  function urlAPI(params) {
    const finalParams = { ...params, APIkey: CONFIG.API_KEY };
    const qs = Object.keys(finalParams)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(finalParams[k])}`)
      .join("&");
    return `${CONFIG.API_HOST}?${qs}`;
  }

  async function fetchAPI(params) {
    const res = await fetch(urlAPI(params));
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    if (data && data.error) throw new Error(Array.isArray(data.error) ? data.error.join(" | ") : data.error);
    return Array.isArray(data) ? data : [];
  }

  function n(valor, fallback = 0) {
    const x = parseFloat(valor);
    return Number.isFinite(x) ? x : fallback;
  }

  function calcularStatsDesdeStanding(row) {
    const pj = Math.max(1, n(row?.overall_league_payed, 0));
    const gf = +(n(row?.overall_league_GF, 0) / pj).toFixed(2) || 1.2;
    const ga = +(n(row?.overall_league_GA, 0) / pj).toFixed(2) || 1.2;
    const cf = +(4.5 + (gf - 1.2) * 1.6).toFixed(1);
    const ca = +(4.5 + (ga - 1.2) * 1.6).toFixed(1);
    return { gf, ga, cf, ca };
  }

  async function standingPorLiga(leagueId) {
    if (!leagueId) return new Map();
    try {
      const rows = await fetchAPI({ action: "get_standings", league_id: leagueId });
      const mapa = new Map();
      rows.forEach(r => {
        const stats = calcularStatsDesdeStanding(r);
        if (r.team_id) mapa.set(String(r.team_id), stats);
        if (r.team_name) mapa.set(String(r.team_name).toLowerCase(), stats);
      });
      return mapa;
    } catch (e) {
      console.warn("No se pudo cargar standings para liga", leagueId, e);
      return new Map();
    }
  }

  function statsEquipo(fx, mapa, lado) {
    const id = lado === "home" ? fx.match_hometeam_id : fx.match_awayteam_id;
    const name = lado === "home" ? fx.match_hometeam_name : fx.match_awayteam_name;
    return mapa.get(String(id)) || mapa.get(String(name || "").toLowerCase()) || { gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5 };
  }

  async function fixturesPorLiga(fecha, leagueId) {
    const params = { action: "get_events", from: fecha, to: fecha };
    if (leagueId) params.league_id = leagueId;
    return fetchAPI(params);
  }

  async function partidosReales() {
    const fecha = fechaObjetivo();
    const ligas = CONFIG.LIGAS.length ? CONFIG.LIGAS : [""];
    const partidos = [];

    for (const leagueId of ligas) {
      const fixtures = await fixturesPorLiga(fecha, leagueId);
      const leagueIds = [...new Set(fixtures.map(fx => fx.league_id).filter(Boolean))];
      const standings = new Map();

      for (const lid of leagueIds) {
        standings.set(String(lid), await standingPorLiga(lid));
      }

      for (const fx of fixtures) {
        const mapa = standings.get(String(fx.league_id)) || new Map();
        const statsL = statsEquipo(fx, mapa, "home");
        const statsV = statsEquipo(fx, mapa, "away");

        partidos.push({
          id: fx.match_id || `${fx.match_hometeam_name}-${fx.match_awayteam_name}`,
          liga: fx.league_name || "Liga",
          fecha,
          hora: fx.match_time || "--:--",
          local: { name: fx.match_hometeam_name || "Local", ...statsL },
          visitante: { name: fx.match_awayteam_name || "Visitante", ...statsV }
        });
      }
    }

    return partidos;
  }

  async function obtenerPartidos() {
    const base = { demo: false, dia: CONFIG.DIA_OBJETIVO, fecha: fechaObjetivo(), error: null };

    if (CONFIG.USAR_DEMO || !CONFIG.API_KEY || CONFIG.API_KEY === "PEGA_TU_API_KEY_AQUI") {
      return { ...base, partidos: [], error: "API KEY no configurada." };
    }

    try {
      const partidos = await partidosReales();
      return { ...base, partidos };
    } catch (e) {
      console.error("Error con la API:", e);
      return { ...base, partidos: [], error: e.message };
    }
  }

  return { CONFIG, obtenerPartidos };
})();

window.RoprostData = RoprostData;
