/* =====================================================================
   ROPROST PREDICT — CAPA DE DATOS REALES (roprost-live.js)
   ---------------------------------------------------------------------
   Conexión preparada para APIfootball (apiv3.apifootball.com).
   ===================================================================== */

const RoprostData = (() => {

  const CONFIG = {
    API_KEY: "e202c0f5eebf36c56ec54c296fffe77587457afb2c8f2cf3bb216ca2578938d3",
    API_HOST: "https://apiv3.apifootball.com/",
    LIGAS: [],
    DIA_OBJETIVO: "manana",
    USAR_DEMO: false
  };

  const cacheUltimos = new Map();

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
    const qs = Object.keys(finalParams).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(finalParams[k])}`).join("&");
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
    const gfRaw = n(row?.overall_league_GF, 0) / pj;
    const gaRaw = n(row?.overall_league_GA, 0) / pj;
    const gf = +(gfRaw > 0 ? gfRaw : 1.2).toFixed(2);
    const ga = +(gaRaw > 0 ? gaRaw : 1.2).toFixed(2);
    // La tabla de posiciones (plan gratis) no trae córners: se ESTIMAN a
    // partir del perfil ofensivo/defensivo, con más amplitud que antes para
    // que el ritmo de córners varíe de un partido a otro.
    const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
    const cf = +clamp(2.5 + gf * 2.2, 2.5, 8.5).toFixed(1);
    const ca = +clamp(2.5 + ga * 2.2, 2.5, 8.5).toFixed(1);
    return { gf, ga, cf, ca, statsReales: true };
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
    return mapa.get(String(id)) || mapa.get(String(name || "").toLowerCase()) || { gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5, statsReales: false };
  }

  function logoEquipo(fx, lado) {
    if (lado === "home") return fx.team_home_badge || fx.match_hometeam_logo || fx.home_badge || "";
    return fx.team_away_badge || fx.match_awayteam_logo || fx.away_badge || "";
  }

  function estadoNormalizado(fx) {
    const status = String(fx.match_status || "").trim().toLowerCase();
    const scoreLocal = fx.match_hometeam_score;
    const scoreVisita = fx.match_awayteam_score;
    const tieneMarcador = scoreLocal !== undefined && scoreVisita !== undefined && scoreLocal !== "" && scoreVisita !== "";
    if (status.includes("finished") || status.includes("final") || status === "ft" || status === "after penalties") return "finalizado";
    if (status === "half time" || status === "ht" || status.includes("live") || /^\d+/.test(status)) return "en vivo";
    if (tieneMarcador && status && status !== "not started") return "en vivo";
    return "programado";
  }

  function valorCorner(fx, lado) {
    const keysHome = ["match_hometeam_corners", "match_hometeam_corner", "hometeam_corners", "home_corners", "match_home_corners"];
    const keysAway = ["match_awayteam_corners", "match_awayteam_corner", "awayteam_corners", "away_corners", "match_away_corners"];
    const keys = lado === "home" ? keysHome : keysAway;
    for (const k of keys) {
      if (fx[k] !== undefined && fx[k] !== "") return fx[k];
    }
    return null;
  }

  async function fixturesPorLiga(fecha, leagueId) {
    const params = { action: "get_events", from: fecha, to: fecha };
    if (leagueId) params.league_id = leagueId;
    return fetchAPI(params);
  }

  async function ultimosPartidosEquipo(teamId) {
    if (!teamId) return [];
    const key = String(teamId);
    if (cacheUltimos.has(key)) return cacheUltimos.get(key);
    try {
      const rows = await fetchAPI({ action: "get_events", team_id: teamId, from: fechaPeru(-120), to: fechaPeru(0) });
      const lista = rows.filter(fx => fx.match_hometeam_score !== "" && fx.match_awayteam_score !== "").slice(-5).reverse().map(fx => ({
        fecha: fx.match_date || "",
        local: fx.match_hometeam_name || "Local",
        visitante: fx.match_awayteam_name || "Visitante",
        marcador: `${fx.match_hometeam_score ?? "-"}-${fx.match_awayteam_score ?? "-"}`
      }));
      cacheUltimos.set(key, lista);
      return lista;
    } catch (e) {
      cacheUltimos.set(key, []);
      return [];
    }
  }

  function mapFixtureBasico(fx, fecha, statsL = { gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5, statsReales: false }, statsV = { gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5, statsReales: false }) {
    const estado = estadoNormalizado(fx);
    const cornersLocal = valorCorner(fx, "home");
    const cornersVisitante = valorCorner(fx, "away");
    return {
      id: fx.match_id || `${fx.match_hometeam_name}-${fx.match_awayteam_name}`,
      liga: fx.league_name || "Liga",
      fecha: fx.match_date || fecha,
      hora: fx.match_time || "--:--",
      estado,
      finalizado: estado === "finalizado",
      enVivo: estado === "en vivo",
      golesLocal: fx.match_hometeam_score,
      golesVisitante: fx.match_awayteam_score,
      cornersLocal,
      cornersVisitante,
      local: { id: fx.match_hometeam_id, name: fx.match_hometeam_name || "Local", logo: logoEquipo(fx, "home"), ultimos: [], ...statsL },
      visitante: { id: fx.match_awayteam_id, name: fx.match_awayteam_name || "Visitante", logo: logoEquipo(fx, "away"), ultimos: [], ...statsV }
    };
  }

  async function partidosReales() {
    const fecha = fechaObjetivo();
    const ligas = CONFIG.LIGAS.length ? CONFIG.LIGAS : [""];
    const partidos = [];
    for (const leagueId of ligas) {
      const fixtures = await fixturesPorLiga(fecha, leagueId);
      const leagueIds = [...new Set(fixtures.map(fx => fx.league_id).filter(Boolean))];
      const standings = new Map();
      for (const lid of leagueIds) standings.set(String(lid), await standingPorLiga(lid));
      for (const fx of fixtures) {
        const mapa = standings.get(String(fx.league_id)) || new Map();
        const p = mapFixtureBasico(fx, fecha, statsEquipo(fx, mapa, "home"), statsEquipo(fx, mapa, "away"));
        p.local.ultimos = await ultimosPartidosEquipo(p.local.id);
        p.visitante.ultimos = await ultimosPartidosEquipo(p.visitante.id);
        partidos.push(p);
      }
    }
    return partidos;
  }

  async function partidosSeguimiento() {
    try {
      const fechas = [fechaPeru(-2), fechaPeru(-1), fechaPeru(0)];
      const rows = [];
      for (const fecha of fechas) {
        const fixtures = await fixturesPorLiga(fecha, "");
        rows.push(...fixtures.map(fx => mapFixtureBasico(fx, fecha)));
      }
      const unicos = new Map();
      rows.forEach(p => unicos.set(String(p.id), p));
      return [...unicos.values()]
        .filter(p => p.finalizado || p.enVivo)
        .sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`))
        .slice(0, 30);
    } catch (e) {
      console.warn("No se pudo cargar seguimiento en vivo/finalizados", e);
      return [];
    }
  }

  async function obtenerPartidos() {
    const base = { demo: false, dia: CONFIG.DIA_OBJETIVO, fecha: fechaObjetivo(), error: null };
    if (CONFIG.USAR_DEMO || !CONFIG.API_KEY || CONFIG.API_KEY === "PEGA_TU_API_KEY_AQUI") {
      return { ...base, partidos: [], seguimiento: [], finalizados: [], error: "API KEY no configurada." };
    }
    try {
      const [partidos, seguimiento] = await Promise.all([partidosReales(), partidosSeguimiento()]);
      return { ...base, partidos, seguimiento, finalizados: seguimiento.filter(p => p.finalizado) };
    } catch (e) {
      console.error("Error con la API:", e);
      return { ...base, partidos: [], seguimiento: [], finalizados: [], error: e.message };
    }
  }

  return { CONFIG, obtenerPartidos };
})();

window.RoprostData = RoprostData;
