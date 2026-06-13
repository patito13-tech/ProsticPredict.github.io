/* =====================================================================
   ROPROST PREDICT — API-SPORTS CORNERS
   Sirve para buscar estadísticas reales de córners usando API-Football.
   ===================================================================== */
const RoprostCornersAPI = (() => {
  const CONFIG = {
    API_KEY: "902e20d8bd9a71791edc25f3da7f9b30",
    API_HOST: "https://v3.football.api-sports.io",
    TIMEOUT_MS: 10000
  };
  const cacheFixtures = new Map();
  const cacheStats = new Map();
  function normalizar(txt) {
    return String(txt || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function parecido(a, b) {
    const x = normalizar(a);
    const y = normalizar(b);
    if (!x || !y) return false;
    return x === y || x.includes(y) || y.includes(x);
  }
  async function fetchAPI(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);
    try {
      const res = await fetch(CONFIG.API_HOST + path, {
        method: "GET",
        headers: {
          "x-apisports-key": CONFIG.API_KEY
        },
        signal: controller.signal
      });
      if (!res.ok) throw new Error("API-Sports error " + res.status);
      const data = await res.json();
      return data.response || [];
    } finally {
      clearTimeout(timer);
    }
  }
  async function buscarFixture(partido) {
    const fecha = String(partido.fecha || "").slice(0, 10);
    if (!fecha) return null;
    if (!cacheFixtures.has(fecha)) {
      const lista = await fetchAPI(`/fixtures?date=${encodeURIComponent(fecha)}`);
      cacheFixtures.set(fecha, lista);
    }
    const fixtures = cacheFixtures.get(fecha) || [];
    const localNombre = partido.local?.name || partido.local?.nombre || "";
    const visitaNombre = partido.visitante?.name || partido.visitante?.nombre || "";
    const encontrado = fixtures.find(fx => {
      const home = fx?.teams?.home?.name || "";
      const away = fx?.teams?.away?.name || "";
      const a = parecido(home, localNombre) && parecido(away, visitaNombre);
      const b = parecido(home, visitaNombre) && parecido(away, localNombre);
      return a || b;
    });
    return encontrado?.fixture?.id || null;
  }
  function extraerCorners(stats) {
    let homeCorners = null;
    let awayCorners = null;
    stats.forEach(teamStats => {
      const teamName = teamStats?.team?.name;
      const datos = teamStats?.statistics || [];
      const cornerStat = datos.find(s =>
        normalizar(s.type) === "corner kicks" ||
        normalizar(s.type) === "corners" ||
        normalizar(s.type) === "corner"
      );
      const value = Number(cornerStat?.value);
      if (Number.isFinite(value)) {
        if (homeCorners === null) homeCorners = value;
        else awayCorners = value;
      }
    });
    if (homeCorners === null || awayCorners === null) return null;
    return {
      home: homeCorners,
      away: awayCorners,
      total: homeCorners + awayCorners
    };
  }
  async function obtenerCorners(partido) {
    const fixtureId = await buscarFixture(partido);
    if (!fixtureId) return null;
    if (!cacheStats.has(fixtureId)) {
      const stats = await fetchAPI(`/fixtures/statistics?fixture=${fixtureId}`);
      cacheStats.set(fixtureId, stats);
    }
    return extraerCorners(cacheStats.get(fixtureId));
  }
  return {
    obtenerCorners
  };
})();
