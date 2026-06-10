/* =====================================================================
   ROPROST PREDICT — CAPA DE DATOS  (roprost-live.js)
   ---------------------------------------------------------------------
   Aquí va tu API KEY y la conexión con datos reales.
   Por defecto arranca en MODO DEMO (datos de ejemplo) para que la
   página funcione sin configurar nada. Cuando pongas tu key y tus ligas,
   cambia USAR_DEMO a false.
   ===================================================================== */

const RoprostData = (() => {

  /* =================================================================
     1) CONFIGURACIÓN  — EDITA AQUÍ
     ================================================================= */
  const CONFIG = {
    // ⬇️  Pon tu API KEY de API-Football (api-sports.io) aquí
    API_KEY: "TU_API_KEY_AQUI",

    // Proveedor: API-Football v3 (https://www.api-football.com)
    API_HOST: "https://v3.football.api-sports.io",

    // Ligas que quieres analizar (IDs de API-Football) y la temporada
    // Ejemplos de IDs: Premier 39, La Liga 140, Serie A 135, Liga MX 262
    LIGAS: [39, 140, 135],
    TEMPORADA: 2025,

    // true  = datos de ejemplo (funciona sin key)
    // false = datos reales con tu API KEY
    USAR_DEMO: true
  };

  /* ⚠️  NOTA DE SEGURIDAD:
     En una página estática de GitHub Pages, cualquier API KEY en el
     código JS es VISIBLE para quien mire el código fuente. Para uso
     personal suele bastar, pero si la app se vuelve pública, lo ideal
     es poner un pequeño proxy (Cloudflare Worker / Vercel) que guarde
     la key del lado del servidor. */

  /* =================================================================
     2) DATOS DEMO  (porcentajes calculados de verdad sobre estos datos)
        Cada equipo: gf=goles a favor/partido, ga=en contra/partido,
                     cf=córners a favor, ca=córners en contra
     ================================================================= */
  const DEMO = [
    {
      id: 1, liga: "Premier League", fecha: "2026-06-10", hora: "19:00",
      local:     { name: "Manchester City", gf: 2.6, ga: 0.8, cf: 7.2, ca: 3.1 },
      visitante: { name: "Burnley",          gf: 0.9, ga: 2.1, cf: 3.4, ca: 6.0 }
    },
    {
      id: 2, liga: "La Liga", fecha: "2026-06-10", hora: "21:00",
      local:     { name: "Real Madrid", gf: 2.3, ga: 0.9, cf: 6.5, ca: 3.6 },
      visitante: { name: "Getafe",      gf: 1.0, ga: 1.3, cf: 4.0, ca: 5.2 }
    },
    {
      id: 3, liga: "Serie A", fecha: "2026-06-10", hora: "20:45",
      local:     { name: "Juventus", gf: 1.4, ga: 1.0, cf: 5.1, ca: 4.4 },
      visitante: { name: "Torino",   gf: 1.1, ga: 1.2, cf: 4.3, ca: 4.8 }
    },
    {
      id: 4, liga: "Premier League", fecha: "2026-06-10", hora: "17:00",
      local:     { name: "Brighton",       gf: 1.8, ga: 1.5, cf: 6.0, ca: 5.0 },
      visitante: { name: "Tottenham",      gf: 2.0, ga: 1.4, cf: 5.5, ca: 5.3 }
    },
    {
      id: 5, liga: "La Liga", fecha: "2026-06-10", hora: "19:30",
      local:     { name: "Atlético Madrid", gf: 1.6, ga: 0.7, cf: 5.0, ca: 3.8 },
      visitante: { name: "Cádiz",            gf: 0.8, ga: 1.6, cf: 3.5, ca: 5.5 }
    },
    {
      id: 6, liga: "Serie A", fecha: "2026-06-10", hora: "18:00",
      local:     { name: "Inter",  gf: 2.4, ga: 0.8, cf: 6.8, ca: 3.5 },
      visitante: { name: "Lecce",  gf: 0.9, ga: 1.9, cf: 3.8, ca: 6.2 }
    }
  ];

  /* =================================================================
     3) ADAPTADOR API-FOOTBALL v3 (datos reales)
     ================================================================= */
  async function fetchJSON(endpoint) {
    const res = await fetch(`${CONFIG.API_HOST}${endpoint}`, {
      headers: { "x-apisports-key": CONFIG.API_KEY }
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  // Promedios de un equipo en la temporada/liga (goles reales del API)
  async function statsEquipo(teamId, leagueId) {
    const data = await fetchJSON(
      `/teams/statistics?team=${teamId}&league=${leagueId}&season=${CONFIG.TEMPORADA}`
    );
    const r = data.response;
    const gf = parseFloat(r?.goals?.for?.average?.total) || 1.2;
    const ga = parseFloat(r?.goals?.against?.average?.total) || 1.2;
    // El endpoint estándar no entrega córners; usamos un estimado a partir
    // de la fuerza ofensiva (documentado y marcado como aproximación).
    const cf = +(4.5 + (gf - 1.2) * 1.6).toFixed(1);
    const ca = +(4.5 + (ga - 1.2) * 1.6).toFixed(1);
    return { gf, ga, cf, ca };
  }

  async function partidosReales() {
    const hoy = new Date().toISOString().slice(0, 10);
    const partidos = [];
    for (const leagueId of CONFIG.LIGAS) {
      const fixtures = await fetchJSON(
        `/fixtures?league=${leagueId}&season=${CONFIG.TEMPORADA}&date=${hoy}`
      );
      for (const fx of (fixtures.response || [])) {
        const homeId = fx.teams.home.id;
        const awayId = fx.teams.away.id;
        const [statsL, statsV] = await Promise.all([
          statsEquipo(homeId, leagueId),
          statsEquipo(awayId, leagueId)
        ]);
        partidos.push({
          id: fx.fixture.id,
          liga: fx.league.name,
          fecha: hoy,
          hora: new Date(fx.fixture.date).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
          local:     { name: fx.teams.home.name, ...statsL },
          visitante: { name: fx.teams.away.name, ...statsV }
        });
      }
    }
    return partidos;
  }

  /* =================================================================
     4) PUNTO DE ENTRADA
     ================================================================= */
  async function obtenerPartidos() {
    if (CONFIG.USAR_DEMO || CONFIG.API_KEY === "TU_API_KEY_AQUI") {
      return { partidos: DEMO, demo: true };
    }
    try {
      const partidos = await partidosReales();
      return { partidos, demo: false };
    } catch (e) {
      console.error("Error con la API, usando demo:", e);
      return { partidos: DEMO, demo: true, error: e.message };
    }
  }

  return { CONFIG, obtenerPartidos };
})();

window.RoprostData = RoprostData;
