/* =====================================================================
   ROPROST PREDICT — FORMA Y RACHA BAJO DEMANDA  (roprost-forma.js)
   ---------------------------------------------------------------------
   Carga los últimos partidos de cada equipo SOLO cuando el usuario abre
   una tarjeta de partido (no en la carga inicial, para no ralentizarla).
   - Calcula: Forma últimos 5 (✅ ➖ ❌) y Racha actual.
   - Cachea por equipo durante la sesión y es 100% tolerante a fallos:
     si la API no responde, la tarjeta sigue funcionando igual.
   NO modifica el motor, el diseño ni ninguna función existente.
   ===================================================================== */

const RoprostForma = (() => {
  "use strict";

  const cacheEquipo = new Map();   // teamId -> { form:[], streaks:{} }
  const enCurso     = new Map();   // teamId -> Promise

  /* ── Utilidades de fecha ─────────────────────────────────────────── */
  function isoMenosDias(dias) {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d.toISOString().slice(0, 10);
  }
  function isoHoy() { return new Date().toISOString().slice(0, 10); }

  /* ── Llamada a la API (reutiliza la config pública de RoprostData) ── */
  function urlEventos(teamId) {
    const C = (window.RoprostData && window.RoprostData.CONFIG) || {};
    const params = {
      action:  "get_events",
      from:    isoMenosDias(80),
      to:      isoHoy(),
      team_id: teamId,
      APIkey:  C.API_KEY || ""
    };
    const host = C.API_HOST || "https://apiv3.apifootball.com/";
    return host + "?" + Object.keys(params)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");
  }

  function num(v) { const x = Number(v); return Number.isFinite(x) ? x : NaN; }

  function esJugado(fx) {
    const st = String(fx.match_status || "").trim().toLowerCase();
    const finalizado = st.includes("finished") || st.includes("final") || st === "ft" || st === "after penalties";
    return finalizado && Number.isFinite(num(fx.match_hometeam_score)) && Number.isFinite(num(fx.match_awayteam_score));
  }

  /* ── Cálculo de forma y racha (PURO, testeable) ──────────────────── */
  // Devuelve { form: ['W'|'D'|'L', ...] (cronológico, antiguo→reciente),
  //            streaks: { sinPerder, victorias, derrotas, marcando, recibiendo } }
  function computarForma(eventos, teamId) {
    const tid = String(teamId);
    const jugados = (eventos || [])
      .filter(esJugado)
      .filter(fx => String(fx.match_hometeam_id) === tid || String(fx.match_awayteam_id) === tid)
      .sort((a, b) => String(a.match_date || "").localeCompare(String(b.match_date || "")));

    const resultados = jugados.map(fx => {
      const local = String(fx.match_hometeam_id) === tid;
      const gf = num(local ? fx.match_hometeam_score : fx.match_awayteam_score);
      const ga = num(local ? fx.match_awayteam_score : fx.match_hometeam_score);
      const r  = gf > ga ? "W" : gf < ga ? "L" : "D";
      return { r, gf, ga };
    });

    const form = resultados.slice(-5).map(x => x.r);

    // Racha desde el más reciente hacia atrás
    const rev = [...resultados].reverse();
    const contar = (cond) => { let n = 0; for (const x of rev) { if (cond(x)) n++; else break; } return n; };
    const streaks = {
      sinPerder:  contar(x => x.r !== "L"),
      victorias:  contar(x => x.r === "W"),
      derrotas:   contar(x => x.r === "L"),
      marcando:   contar(x => x.gf >= 1),
      recibiendo: contar(x => x.ga >= 1),
      total:      resultados.length
    };
    return { form, streaks };
  }

  async function datosEquipo(teamId) {
    if (!teamId) return null;
    const key = String(teamId);
    if (cacheEquipo.has(key)) return cacheEquipo.get(key);
    if (enCurso.has(key))     return enCurso.get(key);

    const prom = (async () => {
      try {
        const res = await fetch(urlEventos(teamId));
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("respuesta no válida");
        const calc = computarForma(data, teamId);
        cacheEquipo.set(key, calc);
        return calc;
      } catch (e) {
        console.warn("forma: no se pudo cargar equipo", teamId, e);
        cacheEquipo.set(key, null);   // no reintentar en esta sesión
        return null;
      } finally {
        enCurso.delete(key);
      }
    })();
    enCurso.set(key, prom);
    return prom;
  }

  /* ── Render ──────────────────────────────────────────────────────── */
  const ICONO = { W: "✅", D: "➖", L: "❌" };

  function htmlForma(form) {
    if (!form || !form.length) return `<span class="rp-forma-na">sin datos</span>`;
    return form.map(r => `<span class="rp-forma-ico">${ICONO[r] || "➖"}</span>`).join("");
  }

  function htmlRacha(streaks) {
    if (!streaks || !streaks.total) return "";
    const badges = [];
    if (streaks.victorias >= 2)      badges.push(`🔥 ${streaks.victorias} victorias seguidas`);
    else if (streaks.sinPerder >= 3) badges.push(`🛡️ ${streaks.sinPerder} sin perder`);
    else if (streaks.derrotas >= 2)  badges.push(`⚠️ ${streaks.derrotas} derrotas seguidas`);
    if (streaks.marcando >= 3)   badges.push(`⚽ ${streaks.marcando} marcando gol`);
    if (streaks.recibiendo >= 3) badges.push(`🥅 ${streaks.recibiendo} recibiendo gol`);
    if (!badges.length) badges.push("Sin racha destacable");
    return badges.map(b => `<span class="rp-racha-badge">${b}</span>`).join("");
  }

  function filaEquipo(nombre, datos) {
    if (!datos) {
      return `<div class="rp-forma-fila"><span class="rp-forma-team">${nombre}</span><span class="rp-forma-na">Forma no disponible</span></div>`;
    }
    return `<div class="rp-forma-fila">
      <span class="rp-forma-team">${nombre}</span>
      <span class="rp-forma-iconos">${htmlForma(datos.form)}</span>
      <span class="rp-racha">${htmlRacha(datos.streaks)}</span>
    </div>`;
  }

  async function cargarEnContenedor(cont) {
    if (!cont || cont.dataset.loaded === "1") return;
    cont.dataset.loaded = "1";   // marca inmediata: evita dobles cargas
    const localId  = cont.dataset.localid;
    const visitaId = cont.dataset.visitaid;
    const match    = cont.closest(".match");
    const nombres  = match ? [...match.querySelectorAll(".team-line")].map(e => e.textContent.trim()) : ["Local", "Visitante"];

    try {
      const [dl, dv] = await Promise.all([datosEquipo(localId), datosEquipo(visitaId)]);
      if (!dl && !dv) {
        cont.innerHTML = `<div class="rp-forma-na">Forma y racha no disponibles para este partido.</div>`;
        return;
      }
      cont.innerHTML = `
        <div class="rp-forma-title">📈 Forma últimos 5 · Racha actual</div>
        ${filaEquipo(nombres[0] || "Local", dl)}
        ${filaEquipo(nombres[1] || "Visitante", dv)}`;
    } catch (e) {
      console.warn("forma: render falló", e);
      cont.innerHTML = `<div class="rp-forma-na">Forma y racha no disponibles.</div>`;
    }
  }

  /* ── Enganche por delegación (no pisa los handlers de app-main) ──── */
  function init() {
    document.addEventListener("click", (e) => {
      const head = e.target.closest && e.target.closest(".match-head");
      if (!head) return;
      const match = head.closest(".match");
      if (!match) return;
      // Esperar al toggle de .open que hace app-main, luego cargar.
      setTimeout(() => {
        if (match.classList.contains("open")) {
          const cont = match.querySelector(".rp-forma");
          if (cont) cargarEnContenedor(cont);
        }
      }, 60);
    }, false);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  // Exporta el cálculo puro para pruebas
  return { computarForma };
})();

if (typeof window !== "undefined") window.RoprostForma = RoprostForma;
if (typeof module !== "undefined") module.exports = RoprostForma;
