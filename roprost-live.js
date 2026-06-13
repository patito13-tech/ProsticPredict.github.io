/* =====================================================================
   ROPROST PREDICT — CAPA DE DATOS REALES (roprost-live.js)
   ===================================================================== */

const RoprostData = (() => {

  const CONFIG = {
    API_KEY: "e202c0f5eebf36c56ec54c296fffe77587457afb2c8f2cf3bb216ca2578938d3",
    API_HOST: "https://apiv3.apifootball.com/",
    LIGAS: [],
    DIA_OBJETIVO: "manana",
    USAR_DEMO: false
  };

  function fechaPeru(offsetDias = 0) {
    const ahora = new Date();
    const peru = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Lima" }));
    peru.setDate(peru.getDate() + offsetDias);
    const yyyy = peru.getFullYear();
    const mm   = String(peru.getMonth() + 1).padStart(2, "0");
    const dd   = String(peru.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function urlAPI(params) {
    const p = { ...params, APIkey: CONFIG.API_KEY };
    return CONFIG.API_HOST + "?" + Object.keys(p).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`).join("&");
  }

  async function fetchAPI(params) {
    const res = await fetch(urlAPI(params));
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    if (data && data.error) throw new Error(Array.isArray(data.error) ? data.error.join(" | ") : data.error);
    return Array.isArray(data) ? data : [];
  }

  function n(v, fb = 0) { const x = parseFloat(v); return Number.isFinite(x) ? x : fb; }

  function calcularStatsDesdeStanding(row) {
    const pj  = Math.max(1, n(row?.overall_league_payed, 0));
    const gfR = n(row?.overall_league_GF, 0) / pj;
    const gaR = n(row?.overall_league_GA, 0) / pj;
    const gf  = +(gfR > 0 ? gfR : 1.2).toFixed(2);
    const ga  = +(gaR > 0 ? gaR : 1.2).toFixed(2);
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const cf  = +clamp(2.5 + gf * 2.2, 2.5, 8.5).toFixed(1);
    const ca  = +clamp(2.5 + ga * 2.2, 2.5, 8.5).toFixed(1);
    return { gf, ga, cf, ca, statsReales: true };
  }

  async function standingPorLiga(leagueId) {
    if (!leagueId) return new Map();
    try {
      const rows = await fetchAPI({ action: "get_standings", league_id: leagueId });
      const mapa = new Map();
      rows.forEach(r => {
        const stats = calcularStatsDesdeStanding(r);
        if (r.team_id)   mapa.set(String(r.team_id), stats);
        if (r.team_name) mapa.set(String(r.team_name).toLowerCase(), stats);
      });
      return mapa;
    } catch (e) {
      console.warn("standings error liga", leagueId, e);
      return new Map();
    }
  }

  function statsEquipo(fx, mapa, lado) {
    const id   = lado === "home" ? fx.match_hometeam_id   : fx.match_awayteam_id;
    const name = lado === "home" ? fx.match_hometeam_name : fx.match_awayteam_name;
    return mapa.get(String(id)) || mapa.get(String(name || "").toLowerCase())
      || { gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5, statsReales: false };
  }

  function logoEquipo(fx, lado) {
    if (lado === "home") return fx.team_home_badge || fx.match_hometeam_logo || fx.home_badge || "";
    return fx.team_away_badge || fx.match_awayteam_logo || fx.away_badge || "";
  }

  function estadoNormalizado(fx) {
    const st = String(fx.match_status || "").trim().toLowerCase();
    const tieneScore = fx.match_hometeam_score !== undefined && fx.match_hometeam_score !== ""
                    && fx.match_awayteam_score !== undefined && fx.match_awayteam_score !== "";
    if (st.includes("finished") || st.includes("final") || st === "ft" || st === "after penalties") return "finalizado";
    if (st === "half time" || st === "ht" || st.includes("live") || /^\d+/.test(st)) return "en vivo";
    if (tieneScore && st && st !== "not started") return "en vivo";
    return "programado";
  }

  function valorCorner(fx, lado) {
    const keys = lado === "home"
      ? ["match_hometeam_corners","match_hometeam_corner","hometeam_corners","home_corners","match_home_corners"]
      : ["match_awayteam_corners","match_awayteam_corner","awayteam_corners","away_corners","match_away_corners"];
    for (const k of keys) { if (fx[k] !== undefined && fx[k] !== "") return fx[k]; }
    return null;
  }

  function mapFixture(fx, fecha, statsL, statsV) {
    const sL = statsL || { gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5, statsReales: false };
    const sV = statsV || { gf: 1.2, ga: 1.2, cf: 4.5, ca: 4.5, statsReales: false };
    const estado = estadoNormalizado(fx);
    return {
      id: fx.match_id || `${fx.match_hometeam_name}-${fx.match_awayteam_name}`,
      liga: fx.league_name || "Liga",
      fecha: fx.match_date || fecha,
      hora: fx.match_time || "--:--",
      estado,
      finalizado: estado === "finalizado",
      enVivo:     estado === "en vivo",
      golesLocal:      fx.match_hometeam_score,
      golesVisitante:  fx.match_awayteam_score,
      cornersLocal:    valorCorner(fx, "home"),
      cornersVisitante:valorCorner(fx, "away"),
      local:     { id: fx.match_hometeam_id, name: fx.match_hometeam_name || "Local",     logo: logoEquipo(fx,"home"), ultimos: [], ...sL },
      visitante: { id: fx.match_awayteam_id, name: fx.match_awayteam_name || "Visitante", logo: logoEquipo(fx,"away"), ultimos: [], ...sV }
    };
  }

  // Carga fixtures de una fecha + standings en paralelo por liga
  async function cargarFecha(fecha) {
    const ligas = CONFIG.LIGAS.length ? CONFIG.LIGAS : [""];
    const allFixtures = [];

    // 1. Traer todos los fixtures de la fecha (una sola llamada si LIGAS está vacío)
    await Promise.all(ligas.map(async lid => {
      try {
        const params = { action: "get_events", from: fecha, to: fecha };
        if (lid) params.league_id = lid;
        const fxs = await fetchAPI(params);
        allFixtures.push(...fxs);
      } catch(e) { console.warn("fixtures error", fecha, lid, e); }
    }));

    if (!allFixtures.length) return [];

    // 2. Standings de cada liga en paralelo (no secuencial)
    const ligaIds = [...new Set(allFixtures.map(fx => fx.league_id).filter(Boolean))];
    const standingsArr = await Promise.all(ligaIds.map(lid => standingPorLiga(lid)));
    const standings = new Map();
    ligaIds.forEach((lid, i) => standings.set(String(lid), standingsArr[i]));

    // 3. Mapear partidos — SIN llamadas extra de últimos partidos (eso era lo que tardaba)
    return allFixtures.map(fx => {
      const mapa = standings.get(String(fx.league_id)) || new Map();
      return mapFixture(fx, fecha, statsEquipo(fx, mapa, "home"), statsEquipo(fx, mapa, "away"));
    });
  }

  // Seguimiento: últimas 48 h para historial de resultados
  async function cargarSeguimiento() {
    try {
      const fechas = [fechaPeru(-1), fechaPeru(0)];
      const rows = (await Promise.all(fechas.map(f =>
        fetchAPI({ action: "get_events", from: f, to: f }).catch(() => [])
      ))).flat();
      const unicos = new Map();
      rows.forEach(fx => {
        const p = mapFixture(fx, fx.match_date || "");
        unicos.set(String(p.id), p);
      });
      return [...unicos.values()]
        .filter(p => p.finalizado || p.enVivo)
        .sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`))
        .slice(0, 30);
    } catch(e) {
      console.warn("seguimiento error", e);
      return [];
    }
  }

  async function obtenerPartidos() {
    const fechaHoy    = fechaPeru(0);
    const fechaManana = fechaPeru(1);
    const base = { demo: false, dia: "ambos", fechaHoy, fechaManana, fecha: fechaManana, error: null };

    if (CONFIG.USAR_DEMO || !CONFIG.API_KEY || CONFIG.API_KEY === "PEGA_TU_API_KEY_AQUI") {
      return { ...base, partidos: [], partidosHoy: [], partidosManana: [], seguimiento: [], finalizados: [], error: "API KEY no configurada." };
    }

    try {
      // Todo en paralelo: hoy + mañana + seguimiento al mismo tiempo
      const [hoy, manana, seguimiento] = await Promise.all([
        cargarFecha(fechaHoy),
        cargarFecha(fechaManana),
        cargarSeguimiento()
      ]);

      return {
        ...base,
        partidos:       [...hoy, ...manana],
        partidosHoy:    hoy,
        partidosManana: manana,
        seguimiento,
        finalizados: seguimiento.filter(p => p.finalizado)
      };
    } catch(e) {
      console.error("Error API:", e);
      return { ...base, partidos: [], partidosHoy: [], partidosManana: [], seguimiento: [], finalizados: [], error: e.message };
    }
  }

  return { CONFIG, obtenerPartidos };
})();

window.RoprostData = RoprostData;
