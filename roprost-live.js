/* =====================================================================
   ROPROST PREDICT — CAPA DE DATOS REALES (roprost-live.js)
   ---------------------------------------------------------------------
   Conexión preparada para APIfootball (apiv3.apifootball.com).
   Pega tu API KEY en CONFIG.API_KEY y mantén USAR_DEMO en false.
   ===================================================================== */

const RoprostData = (() => {

  const CONFIG = {
    // Pega aquí tu API KEY de APIfootball.
    API_KEY: "e202c0f5eebf36c56ec54c296fffe77587457afb2c8f2cf3bb216ca2578938d3",
    API_HOST: "https://apiv3.apifootball.com/",

    // En APIfootball los IDs de ligas no son los mismos de API-Sports.
    // Vacío = trae todos los partidos disponibles del día.
    LIGAS: [],

    USAR_DEMO: false
  };

  /* ⚠️ NOTA DE SEGURIDAD:
     En GitHub Pages cualquier API KEY escrita en JS queda visible para
     cualquiera que abra el código fuente. Para uso personal puede servir,
     pero para una web pública lo ideal es usar un proxy backend. */

  const DEMO = [
    { id: 1, liga: "Premier League", fecha: "2026-06-10", hora: "19:00", local: { name: "Manchester City", gf: 2.6, ga: 0.8, cf: 7.2, ca: 3.1 }, visitante: { name: "Burnley", gf: 0.9, ga: 2.1, cf: 3.4, ca: 6.0 } },
    { id: 2, liga: "La Liga", fecha: "2026-06-10", hora: "21:00", local: { name: "Real Madrid", gf: 2.3, ga: 0.9, cf: 6.5, ca: 3.6 }, visitante: { name: "Getafe", gf: 1.0, ga: 1.3, cf: 4.0, ca: 5.2 } },
    { id: 3, liga: "Serie A", fecha: "2026-06-10", hora: "20:45", local: { name: "Juventus", gf: 1.4, ga: 1.0, cf: 5.1, ca: 4.4 }, visitante: { name: "Torino", gf: 1.1, ga: 1.2, cf: 4.3, ca: 4.8 } },
    { id: 4, liga: "Premier League", fecha: "2026-06-10", hora: "17:00", local: { name: "Brighton", gf: 1.8, ga: 1.5, cf: 6.0, ca: 5.0 }, visitante: { name: "Tottenham", gf: 2.0, ga: 1.4, cf: 5.5, ca: 5.3 } },
    { id: 5, liga: "La Liga", fecha: "2026-06-10", hora: "19:30", local: { name: "Atlético Madrid", gf: 1.6, ga: 0.7, cf: 5.0, ca: 3.8 }, visitante: { name: "Cádiz", gf: 0.8, ga: 1.6, cf: 3.5, ca: 5.5 } },
    { id: 6, liga: "Serie A", fecha: "2026-06-10", hora: "18:00", local: { name: "Inter", gf: 2.4, ga: 0.8, cf: 6.8, ca: 3.5 }, visitante: { name: "Lecce", gf: 0.9, ga: 1.9, cf: 3.8, ca: 6.2 } }
  ];

  function fechaHoy() {
    return new Date().toISOString().slice(0, 10);
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
    const fecha = fechaHoy();
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
    if (CONFIG.USAR_DEMO || !CONFIG.API_KEY || CONFIG.API_KEY === "PEGA_TU_API_KEY_AQUI") {
      return { partidos: DEMO, demo: true };
    }

    try {
      const partidos = await partidosReales();
      if (!partidos.length) return { partidos: DEMO, demo: true };
      return { partidos, demo: false };
    } catch (e) {
      console.error("Error con la API, usando demo:", e);
      return { partidos: DEMO, demo: true, error: e.message };
    }
  }

  return { CONFIG, obtenerPartidos };
})();

window.RoprostData = RoprostData;
