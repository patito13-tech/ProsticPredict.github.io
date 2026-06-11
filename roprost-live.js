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

  function logoEquipo(fx, lado) {
    if (lado === "home") {
      return fx.team_home_badge || fx.match_hometeam_logo || fx.home_badge || "";
    }
    return fx.team_away_badge || fx.match_awayteam_logo || fx.away_badge || "";
  }

  function finalizado(fx) {
    const status = String(fx.match_status || "").toLowerCase();
    return status.includes("finished") || status.includes("final") || status === "ft" || status === "after penalties" || Boolean(fx.match_hometeam_score && fx.match_awayteam_score && fx.match_status === "Finished");
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
      const rows = await fetchAPI({
        action: "get_events",
        team_id: teamId,
        from: fechaPeru(-120),
        to: fechaPeru(0)
      });

      const lista = rows
        .filter(fx => fx.match_hometeam_score !== "" && fx.match_awayteam_score !== "")
        .slice(-5)
        .reverse()
        .map(fx => ({
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
        const homeId = fx.match_hometeam_id;
        const awayId = fx.match_awayteam_id;

        partidos.push({
          id: fx.match_id || `${fx.match_hometeam_name}-${fx.match_awayteam_name}`,
          liga: fx.league_name || "Liga",
          fecha,
          hora: fx.match_time || "--:--",
          estado: fx.match_status || "Programado",
          finalizado: finalizado(fx),
          golesLocal: fx.match_hometeam_score,
          golesVisitante: fx.match_awayteam_score,
          local: {
            id: homeId,
            name: fx.match_hometeam_name || "Local",
            logo: logoEquipo(fx, "home"),
            ultimos: await ultimosPartidosEquipo(homeId),
            ...statsL
          },
          visitante: {
            id: awayId,
            name: fx.match_awayteam_name || "Visitante",
            logo: logoEquipo(fx, "away"),
            ultimos: await ultimosPartidosEquipo(awayId),
            ...statsV
          }
        });
      }
    }

    return partidos;
  }

  async function partidosRecientesFinalizados() {
    try {
      const rows = [];
      for (const fecha of [fechaPeru(-1), fechaPeru(0)]) {
        const fixtures = await fixturesPorLiga(fecha, "");
        rows.push(...fixtures);
      }
      return rows
        .filter(finalizado)
        .slice(-20)
        .map(fx => ({
          id: fx.match_id || `${fx.match_hometeam_name}-${fx.match_awayteam_name}`,
          liga: fx.league_name || "Liga",
          fecha: fx.match_date || "",
          hora: fx.match_time || "",
          local: { name: fx.match_hometeam_name || "Local", logo: logoEquipo(fx, "home"), gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5 },
          visitante: { name: fx.match_awayteam_name || "Visitante", logo: logoEquipo(fx, "away"), gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5 },
          finalizado: true,
          golesLocal: fx.match_hometeam_score,
          golesVisitante: fx.match_awayteam_score
        }));
    } catch (e) {
      return [];
    }
  }

  async function obtenerPartidos() {
    const base = { demo: false, dia: CONFIG.DIA_OBJETIVO, fecha: fechaObjetivo(), error: null };

    if (CONFIG.USAR_DEMO || !CONFIG.API_KEY || CONFIG.API_KEY === "PEGA_TU_API_KEY_AQUI") {
      return { ...base, partidos: [], finalizados: [], error: "API KEY no configurada." };
    }

    try {
      const [partidos, finalizados] = await Promise.all([
        partidosReales(),
        partidosRecientesFinalizados()
      ]);
      return { ...base, partidos, finalizados };
    } catch (e) {
      console.error("Error con la API:", e);
      return { ...base, partidos: [], finalizados: [], error: e.message };
    }
  }

  return { CONFIG, obtenerPartidos };
})();

window.RoprostData = RoprostData;
