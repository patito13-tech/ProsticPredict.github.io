/* =====================================================================
   ROPROST PREDICT — CAPA DE DATOS REALES (roprost-live.js)
   ---------------------------------------------------------------------
   MEJORA #1: Los stats de cada equipo (goles a favor/en contra, córners)
   se calculan a partir de sus ÚLTIMOS PARTIDOS REALES (get_events),
   no de la tabla de posiciones. Esto:
     - Evita los errores 413/404 de standings que forzaban valores por
       defecto y hacían que casi todo saliera "doble oportunidad".
     - Usa forma reciente real en vez de promedio de temporada.
     - Solo usa córners si la API realmente los provee (hoy no lo hace).
   La tabla de posiciones queda como respaldo si los recientes no alcanzan.
   ===================================================================== */

const RoprostData = (() => {

  const CONFIG = {
    API_KEY: "e202c0f5eebf36c56ec54c296fffe77587457afb2c8f2cf3bb216ca2578938d3",
    API_HOST: "https://apiv3.apifootball.com/",
    LIGAS: [],
    DIA_OBJETIVO: "ambos",
    USAR_DEMO: false
  };

  const cacheUltimos = new Map();
  const N_RECIENTES = 10;  // cuántos partidos recientes usar para los promedios

  function fechaPeru(offsetDias = 0) {
    const ahora = new Date();
    const peru = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Lima" }));
    peru.setDate(peru.getDate() + offsetDias);
    const yyyy = peru.getFullYear();
    const mm = String(peru.getMonth() + 1).padStart(2, "0");
    const dd = String(peru.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
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
    const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
    const cf = +clamp(2.5 + gf * 2.2, 2.5, 8.5).toFixed(1);
    const ca = +clamp(2.5 + ga * 2.2, 2.5, 8.5).toFixed(1);
    // Estos córners son ESTIMADOS desde goles (la tabla no trae córners).
    // Por eso van marcados como no-fiables: el motor no debe usarlos.
    return { gf, ga, cf, ca, cornersReales: false, statsReales: true };
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
    return mapa.get(String(id)) || mapa.get(String(name || "").toLowerCase()) || { gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5, cornersReales: false, statsReales: false };
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

  async function fixturesPorFecha(fecha) {
    return fetchAPI({ action: "get_events", from: fecha, to: fecha });
  }

  /* ---------------------------------------------------------------------
     STATS DESDE LOS ÚLTIMOS PARTIDOS REALES  (reemplaza ultimosPartidosEquipo)
     Calcula gf/ga (reales) y cf/ca (solo si la API trae córners), además de
     devolver la lista de últimos partidos para mostrar en la UI.
     --------------------------------------------------------------------- */
  async function statsRecientesEquipo(teamId, teamName) {
    if (!teamId) return { statsReales: false, ultimos: [] };
    const key = String(teamId);
    if (cacheUltimos.has(key)) return cacheUltimos.get(key);
    try {
      const rows = await fetchAPI({ action: "get_events", team_id: teamId, from: fechaPeru(-150), to: fechaPeru(0) });
      const finished = rows
        .filter(fx => fx.match_hometeam_score !== "" && fx.match_awayteam_score !== "" &&
                      fx.match_hometeam_score != null && fx.match_awayteam_score != null)
        .slice(-N_RECIENTES);

      let sumGF = 0, sumGA = 0, sumCF = 0, sumCA = 0, conCorner = 0;
      const ultimos = [];

      finished.forEach(fx => {
        const esLocal = String(fx.match_hometeam_id) === key ||
          String(fx.match_hometeam_name || "").toLowerCase() === String(teamName || "").toLowerCase();
        const gl = n(fx.match_hometeam_score, NaN), gv = n(fx.match_awayteam_score, NaN);
        if (!Number.isFinite(gl) || !Number.isFinite(gv)) return;

        sumGF += esLocal ? gl : gv;
        sumGA += esLocal ? gv : gl;

        // córners reales SOLO si la API los trae (hoy no lo hace, pero queda listo)
        const cl = n(valorCorner(fx, "home"), NaN), cv = n(valorCorner(fx, "away"), NaN);
        if (Number.isFinite(cl) && Number.isFinite(cv)) {
          sumCF += esLocal ? cl : cv;
          sumCA += esLocal ? cv : cl;
          conCorner++;
        }

        ultimos.push({
          fecha: fx.match_date || "",
          local: fx.match_hometeam_name || "Local",
          visitante: fx.match_awayteam_name || "Visitante",
          marcador: `${fx.match_hometeam_score ?? "-"}-${fx.match_awayteam_score ?? "-"}`
        });
      });

      const pj = finished.length;
      // Necesitamos al menos 4 partidos para que el promedio signifique algo
      if (pj < 4) {
        const vacio = { statsReales: false, ultimos: ultimos.reverse() };
        cacheUltimos.set(key, vacio);
        return vacio;
      }

      const cornersReales = conCorner >= 4;
      const stats = {
        gf: +(sumGF / pj).toFixed(2),
        ga: +(sumGA / pj).toFixed(2),
        cf: cornersReales ? +(sumCF / conCorner).toFixed(2) : null,
        ca: cornersReales ? +(sumCA / conCorner).toFixed(2) : null,
        muestra: pj,
        muestraCorners: conCorner,
        cornersReales,
        statsReales: true,
        ultimos: ultimos.reverse()
      };
      cacheUltimos.set(key, stats);
      return stats;
    } catch (e) {
      const vacio = { statsReales: false, ultimos: [] };
      cacheUltimos.set(key, vacio);
      return vacio;
    }
  }

  function mapFixtureBasico(fx, fecha, statsL = { gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5, cornersReales: false, statsReales: false }, statsV = { gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5, cornersReales: false, statsReales: false }) {
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

  async function procesarFixtures(fixtures, fecha) {
    const leagueIds = [...new Set(fixtures.map(fx => fx.league_id).filter(Boolean))];
    const standings = new Map();
    for (const lid of leagueIds) standings.set(String(lid), await standingPorLiga(lid));

    const partidos = [];
    for (const fx of fixtures) {
      const mapa = standings.get(String(fx.league_id)) || new Map();

      // 1º intento: stats de partidos recientes (datos reales)
      const stL = await statsRecientesEquipo(fx.match_hometeam_id, fx.match_hometeam_name);
      const stV = await statsRecientesEquipo(fx.match_awayteam_id, fx.match_awayteam_name);

      // respaldo: la tabla de posiciones, solo si los recientes no sirven
      const usarL = stL.statsReales ? stL : statsEquipo(fx, mapa, "home");
      const usarV = stV.statsReales ? stV : statsEquipo(fx, mapa, "away");

      const p = mapFixtureBasico(fx, fecha, usarL, usarV);
      p.local.ultimos     = stL.ultimos || [];
      p.visitante.ultimos = stV.ultimos || [];
      partidos.push(p);
    }
    return partidos;
  }

  async function partidosReales() {
    const fechaHoy    = fechaPeru(0);
    const fechaManana = fechaPeru(1);

    const [fixturesHoy, fixturesManana] = await Promise.all([
      fixturesPorFecha(fechaHoy),
      fixturesPorFecha(fechaManana)
    ]);

    const [partidosHoy, partidosManana] = await Promise.all([
      procesarFixtures(fixturesHoy, fechaHoy),
      procesarFixtures(fixturesManana, fechaManana)
    ]);

    return [...partidosHoy, ...partidosManana];
  }

  async function partidosSeguimiento() {
    try {
      const fechas = [fechaPeru(-2), fechaPeru(-1), fechaPeru(0)];
      const rows = [];
      for (const fecha of fechas) {
        const fixtures = await fixturesPorFecha(fecha);
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
    const base = { demo: false, dia: "ambos", fecha: fechaPeru(0), error: null };
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
