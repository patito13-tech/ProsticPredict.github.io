/**
 * roprost-results.js
 * Módulo de extensión para Roprost Predict
 * ─────────────────────────────────────────
 * SOLO añade:
 *   1. Pestañas "Hoy" y "Mañana" dentro de la sección Partidos
 *   2. Historial de resultados funcional (localStorage)
 *   3. Estadísticas de rendimiento (ganados / perdidos / nulos / % acierto)
 *
 * NO modifica: Picks, Top, diseño, colores, Poisson, probabilidades.
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════
   * CONSTANTES
   * ═══════════════════════════════════════════════════ */
  const STORAGE_KEY = 'roprost_historial_v1';

  /* ═══════════════════════════════════════════════════
   * UTILIDADES DE FECHA
   * ═══════════════════════════════════════════════════ */
  function fechaLocal(date) {
    // Devuelve "YYYY-MM-DD" en hora local
    const d = date || new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function esHoy(fechaStr) {
    return fechaStr && fechaStr.startsWith(fechaLocal());
  }

  function esMañana(fechaStr) {
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    return fechaStr && fechaStr.startsWith(fechaLocal(manana));
  }

  /* ═══════════════════════════════════════════════════
   * HISTORIAL — persistencia en localStorage
   * ═══════════════════════════════════════════════════ */
  const Historial = {
    get() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      } catch (_) { return []; }
    },
    save(arr) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch (_) {}
    },
    agregar(entrada) {
      const arr = this.get();
      // Evitar duplicados por id de partido
      if (entrada.matchId && arr.some(e => e.matchId === entrada.matchId)) return;
      arr.unshift({ ...entrada, timestamp: Date.now() });
      this.save(arr);
    },
    /** Devuelve solo los del día actual (últimas 24 h para el marcador) */
    ultimas24h() {
      const limite = Date.now() - 24 * 60 * 60 * 1000;
      return this.get().filter(e => e.timestamp >= limite);
    }
  };

  /* ═══════════════════════════════════════════════════
   * ESTADÍSTICAS
   * ═══════════════════════════════════════════════════ */
  function calcularStats(lista) {
    const ganados  = lista.filter(e => e.estado === 'ganado').length;
    const perdidos = lista.filter(e => e.estado === 'perdido').length;
    const nulos    = lista.filter(e => e.estado === 'nulo').length;
    const total    = lista.length;
    const resueltos = ganados + perdidos;
    const precision = resueltos > 0 ? Math.round((ganados / resueltos) * 100) : null;
    return { ganados, perdidos, nulos, total, precision };
  }

  /* ═══════════════════════════════════════════════════
   * RENDERIZADO DE RESULTADOS
   * ═══════════════════════════════════════════════════ */
  function renderResultados(contenedor) {
    const historial = Historial.get();
    const ultimas = Historial.ultimas24h();
    const stats = calcularStats(ultimas);

    // Bloque de estadísticas
    const precisionStr = stats.precision !== null
      ? `<span class="rp-stat-precision">${stats.precision}%</span>`
      : '<span class="rp-stat-precision rp-no-data">—</span>';

    const statsHTML = `
      <div class="rp-stats-bloque">
        <div class="rp-stats-titulo">📊 Rendimiento últimas 24 h</div>
        <div class="rp-stats-grid">
          <div class="rp-stat rp-stat-ganado">
            <span class="rp-stat-num">${stats.ganados}</span>
            <span class="rp-stat-label">✅ Ganados</span>
          </div>
          <div class="rp-stat rp-stat-perdido">
            <span class="rp-stat-num">${stats.perdidos}</span>
            <span class="rp-stat-label">❌ Perdidos</span>
          </div>
          <div class="rp-stat rp-stat-nulo">
            <span class="rp-stat-num">${stats.nulos}</span>
            <span class="rp-stat-label">➖ Nulos</span>
          </div>
          <div class="rp-stat rp-stat-total">
            <span class="rp-stat-num">${stats.total}</span>
            <span class="rp-stat-label">📋 Total</span>
          </div>
        </div>
        <div class="rp-precision-wrap">
          Precisión: ${precisionStr}
          ${stats.precision !== null ? `<span class="rp-precision-sub">(${stats.ganados}/${stats.ganados + stats.perdidos} resueltos)</span>` : ''}
        </div>
        ${historial.length > 0 ? `<button class="rp-btn-limpiar" id="rpBtnLimpiar">🗑 Limpiar historial</button>` : ''}
      </div>`;

    // Lista de resultados
    let listaHTML = '';
    if (historial.length === 0) {
      listaHTML = `
        <div class="rp-empty">
          <p>Aún no hay partidos finalizados con pronósticos guardados.<br>
          Aparecerán aquí en cuanto terminen y se conservarán 24 horas.</p>
        </div>`;
    } else {
      listaHTML = historial.map(e => {
        const iconoEstado = e.estado === 'ganado' ? '✅' : e.estado === 'perdido' ? '❌' : '➖';
        const claseEstado = `rp-resultado-${e.estado}`;
        const hora = e.horaFin || new Date(e.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const fecha = e.fecha || new Date(e.timestamp).toLocaleDateString('es-ES');
        return `
          <div class="rp-resultado-card ${claseEstado}">
            <div class="rp-res-header">
              <span class="rp-res-estado">${iconoEstado} ${e.estado.toUpperCase()}</span>
              <span class="rp-res-hora">${hora} · ${fecha}</span>
            </div>
            <div class="rp-res-partido">${e.local || '?'} <span class="rp-res-vs">vs</span> ${e.visitante || '?'}</div>
            ${e.competicion ? `<div class="rp-res-comp">🏆 ${e.competicion}</div>` : ''}
            <div class="rp-res-detalle">
              <span class="rp-res-pronostico">🎯 Pronóstico: <strong>${e.pronostico || '—'}</strong></span>
              ${e.resultado ? `<span class="rp-res-resultado">📊 Resultado: <strong>${e.resultado}</strong></span>` : ''}
            </div>
          </div>`;
      }).join('');
    }

    contenedor.innerHTML = statsHTML + '<div class="rp-resultados-lista">' + listaHTML + '</div>';

    const btnLimpiar = document.getElementById('rpBtnLimpiar');
    if (btnLimpiar) {
      btnLimpiar.addEventListener('click', () => {
        if (confirm('¿Limpiar todo el historial de resultados?')) {
          Historial.save([]);
          renderResultados(contenedor);
        }
      });
    }
  }

  /* ═══════════════════════════════════════════════════
   * FILTRADO HOY / MAÑANA
   * Busca las tarjetas de partidos ya renderizadas y las filtra
   * ═══════════════════════════════════════════════════ */
  function getCardsPartidos() {
    // Intenta varios selectores según cómo esté construido app-main.js
    const posibles = [
      '.match-card', '.partido-card', '.card-partido',
      '[data-match]', '[data-date]', '.match', '.partido'
    ];
    for (const sel of posibles) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) return Array.from(found);
    }
    // Fallback: cualquier div/article con atributo de fecha
    return Array.from(document.querySelectorAll('[data-fecha], [data-date], [data-matchdate]'));
  }

  function extraerFechaDeCard(card) {
    // 1. Atributos de datos
    const attrs = ['data-fecha', 'data-date', 'data-matchdate', 'data-match-date', 'data-time'];
    for (const a of attrs) {
      if (card.hasAttribute(a)) return card.getAttribute(a);
    }
    // 2. Texto dentro del card que parezca fecha/hora
    const texto = card.textContent || '';
    const m = texto.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    return null;
  }

  function filtrarPartidos(tab) {
    // Encuentra el contenedor padre que tenga los partidos
    const cards = getCardsPartidos();
    if (!cards.length) return;

    cards.forEach(card => {
      const fecha = extraerFechaDeCard(card);
      if (tab === 'hoy') {
        card.style.display = esHoy(fecha) ? '' : 'none';
      } else if (tab === 'manana') {
        card.style.display = esMañana(fecha) ? '' : 'none';
      } else {
        card.style.display = '';
      }
    });
  }

  /* ═══════════════════════════════════════════════════
   * INYECCIÓN DE PESTAÑAS HOY / MAÑANA
   * ═══════════════════════════════════════════════════ */
  function encontrarTabPartidos() {
    // Busca el botón/tab de "Partidos" existente
    const textos = ['Partidos', 'partidos', 'PARTIDOS', 'Matches'];
    const botones = Array.from(document.querySelectorAll('button, a, [role="tab"], .tab, .nav-item'));
    for (const b of botones) {
      if (textos.some(t => b.textContent.trim().includes(t))) return b;
    }
    return null;
  }

  function inyectarSubtabs(contenedorPartidos) {
    if (!contenedorPartidos || contenedorPartidos.querySelector('.rp-subtabs')) return;

    const subtabs = document.createElement('div');
    subtabs.className = 'rp-subtabs';
    subtabs.innerHTML = `
      <button class="rp-subtab rp-subtab-active" data-rp-filter="todos">📅 Todos</button>
      <button class="rp-subtab" data-rp-filter="hoy">📅 Hoy</button>
      <button class="rp-subtab" data-rp-filter="manana">📅 Mañana</button>
    `;

    // Insertar antes del primer partido
    const primerCard = contenedorPartidos.querySelector('.match-card, .partido-card, .card-partido, [data-match]');
    if (primerCard) {
      contenedorPartidos.insertBefore(subtabs, primerCard);
    } else {
      contenedorPartidos.prepend(subtabs);
    }

    subtabs.addEventListener('click', e => {
      const btn = e.target.closest('[data-rp-filter]');
      if (!btn) return;
      subtabs.querySelectorAll('.rp-subtab').forEach(b => b.classList.remove('rp-subtab-active'));
      btn.classList.add('rp-subtab-active');
      filtrarPartidos(btn.dataset.rpFilter);
    });
  }

  /* ═══════════════════════════════════════════════════
   * API PÚBLICA — para llamar desde app-main.js o roprost-logic.js
   * sin modificar esos archivos
   * ═══════════════════════════════════════════════════ */
  window.RoproResults = {
    /**
     * Guardar un resultado cuando un partido termina.
     * Llama a esto desde la consola o desde roprost-live.js si lo extiendes.
     *
     * Ejemplo:
     *   RoproResults.guardar({
     *     matchId: 'abc123',
     *     local: 'Real Madrid',
     *     visitante: 'Barcelona',
     *     competicion: 'La Liga',
     *     pronostico: '1 (Local gana)',
     *     resultado: '2-1',
     *     estado: 'ganado',   // 'ganado' | 'perdido' | 'nulo'
     *     fecha: '2026-06-11',
     *     horaFin: '22:05'
     *   });
     */
    guardar(entrada) {
      if (!entrada || !entrada.estado) {
        console.warn('[RoproResults] Debes indicar estado: ganado | perdido | nulo');
        return;
      }
      Historial.agregar(entrada);
      // Si el panel de resultados está visible, actualizar
      const panel = document.getElementById('rp-resultados-panel');
      if (panel && panel.style.display !== 'none') {
        renderResultados(panel);
      }
    },

    /** Obtener historial completo */
    getHistorial() { return Historial.get(); },

    /** Obtener stats de las últimas 24 h */
    getStats() { return calcularStats(Historial.ultimas24h()); },

    /** Forzar re-render del panel de resultados */
    refrescar() {
      const panel = document.getElementById('rp-resultados-panel');
      if (panel) renderResultados(panel);
    }
  };

  /* ═══════════════════════════════════════════════════
   * OBSERVER: detecta cuando el DOM cambia para inyectar
   * las sub-pestañas sin necesidad de modificar app-main.js
   * ═══════════════════════════════════════════════════ */
  function hookearTabResultados() {
    // Intercept clics en la pestaña "Resultados" existente
    document.addEventListener('click', (e) => {
      const el = e.target.closest('button, a, [role="tab"]');
      if (!el) return;
      const txt = el.textContent.trim();

      if (/resultados/i.test(txt)) {
        setTimeout(() => {
          // Busca el panel de resultados que app-main.js muestra
          let panel = document.getElementById('rp-resultados-panel');
          if (!panel) {
            // Buscar contenedor activo de resultados
            const candidatos = document.querySelectorAll('.tab-content, .panel, .section, [data-tab]');
            for (const c of candidatos) {
              if (c.style.display !== 'none' && /resultado/i.test(c.id + c.className)) {
                panel = c;
                break;
              }
            }
            if (!panel) {
              // Crear panel propio si no existe
              panel = document.createElement('div');
              panel.id = 'rp-resultados-panel';
              // Insertar en el contenedor principal
              const main = document.querySelector('main, #app, .app, #contenedor, body');
              if (main) main.appendChild(panel);
            }
          }
          renderResultados(panel);
        }, 100);
      }

      if (/partidos/i.test(txt) && !/resultado/i.test(txt)) {
        setTimeout(() => {
          // Encuentra el contenedor de partidos activo
          const activos = document.querySelectorAll('.tab-content:not([style*="none"]), [class*="panel"]:not([style*="none"])');
          activos.forEach(c => {
            if (getCardsPartidos().some(card => c.contains(card))) {
              inyectarSubtabs(c);
            }
          });
          // Fallback: intenta inyectar directamente en el contenedor más probable
          const contenedor = document.querySelector('.matches-container, #partidos, .partidos-wrap, [data-section="partidos"]');
          if (contenedor) inyectarSubtabs(contenedor);
        }, 200);
      }
    }, true);
  }

  /* ═══════════════════════════════════════════════════
   * INYECCIÓN DE ESTILOS
   * ═══════════════════════════════════════════════════ */
  function inyectarEstilos() {
    if (document.getElementById('rp-results-styles')) return;
    const style = document.createElement('style');
    style.id = 'rp-results-styles';
    style.textContent = `
      /* ─── Sub-tabs Hoy / Mañana ─── */
      .rp-subtabs {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
        flex-wrap: wrap;
      }
      .rp-subtab {
        background: transparent;
        border: 1px solid rgba(255,255,255,0.15);
        color: rgba(255,255,255,0.65);
        border-radius: 20px;
        padding: 6px 14px;
        font-size: 0.82rem;
        cursor: pointer;
        transition: all 0.2s;
        font-family: inherit;
      }
      .rp-subtab:hover {
        border-color: rgba(255,255,255,0.4);
        color: #fff;
      }
      .rp-subtab-active {
        background: rgba(255,255,255,0.1);
        border-color: rgba(255,255,255,0.5);
        color: #fff;
        font-weight: 600;
      }

      /* ─── Bloque de Estadísticas ─── */
      .rp-stats-bloque {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        padding: 18px 20px;
        margin-bottom: 20px;
      }
      .rp-stats-titulo {
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255,255,255,0.5);
        margin-bottom: 14px;
      }
      .rp-stats-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        margin-bottom: 14px;
      }
      @media (max-width: 480px) {
        .rp-stats-grid { grid-template-columns: repeat(2, 1fr); }
      }
      .rp-stat {
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
        padding: 10px 8px;
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .rp-stat-num {
        font-size: 1.6rem;
        font-weight: 700;
        line-height: 1;
      }
      .rp-stat-label {
        font-size: 0.72rem;
        color: rgba(255,255,255,0.55);
      }
      .rp-stat-ganado  .rp-stat-num { color: #4ade80; }
      .rp-stat-perdido .rp-stat-num { color: #f87171; }
      .rp-stat-nulo    .rp-stat-num { color: rgba(255,255,255,0.5); }
      .rp-stat-total   .rp-stat-num { color: #60a5fa; }

      .rp-precision-wrap {
        font-size: 0.9rem;
        color: rgba(255,255,255,0.8);
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .rp-stat-precision {
        font-size: 1.4rem;
        font-weight: 800;
        color: #4ade80;
      }
      .rp-stat-precision.rp-no-data { color: rgba(255,255,255,0.3); }
      .rp-precision-sub {
        font-size: 0.78rem;
        color: rgba(255,255,255,0.4);
      }

      /* ─── Botón limpiar ─── */
      .rp-btn-limpiar {
        margin-top: 12px;
        background: transparent;
        border: 1px solid rgba(255,80,80,0.3);
        color: rgba(255,120,120,0.8);
        border-radius: 6px;
        padding: 5px 12px;
        font-size: 0.78rem;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.2s;
      }
      .rp-btn-limpiar:hover {
        background: rgba(255,80,80,0.1);
        border-color: rgba(255,80,80,0.6);
      }

      /* ─── Tarjetas de resultados ─── */
      .rp-resultados-lista {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .rp-resultado-card {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        padding: 14px 16px;
        border-left: 3px solid rgba(255,255,255,0.15);
      }
      .rp-resultado-ganado  { border-left-color: #4ade80; }
      .rp-resultado-perdido { border-left-color: #f87171; }
      .rp-resultado-nulo    { border-left-color: rgba(255,255,255,0.3); }

      .rp-res-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
        flex-wrap: wrap;
        gap: 4px;
      }
      .rp-res-estado {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.06em;
      }
      .rp-resultado-ganado  .rp-res-estado { color: #4ade80; }
      .rp-resultado-perdido .rp-res-estado { color: #f87171; }
      .rp-resultado-nulo    .rp-res-estado { color: rgba(255,255,255,0.5); }

      .rp-res-hora {
        font-size: 0.72rem;
        color: rgba(255,255,255,0.4);
      }
      .rp-res-partido {
        font-size: 1rem;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .rp-res-vs {
        font-size: 0.75rem;
        color: rgba(255,255,255,0.4);
        margin: 0 4px;
      }
      .rp-res-comp {
        font-size: 0.75rem;
        color: rgba(255,255,255,0.45);
        margin-bottom: 6px;
      }
      .rp-res-detalle {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        font-size: 0.82rem;
        color: rgba(255,255,255,0.7);
      }
      .rp-res-detalle strong { color: #fff; }

      /* ─── Estado vacío ─── */
      .rp-empty {
        border: 1px dashed rgba(255,255,255,0.1);
        border-radius: 10px;
        padding: 24px;
        text-align: center;
        color: rgba(255,255,255,0.45);
        font-size: 0.88rem;
        line-height: 1.6;
      }

      /* ─── Panel propio si no existe ─── */
      #rp-resultados-panel {
        padding: 8px 0;
      }
    `;
    document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════════════════
   * INTEGRACIÓN CON roprost-live.js (sin modificarlo)
   * Monkeypatching seguro: si existe window.guardarResultado
   * lo envuelve para también guardar en nuestro historial.
   * ═══════════════════════════════════════════════════ */
  function hookearLive() {
    // Esperar a que roprost-live.js cargue y exponga su función
    const MAX = 20;
    let intentos = 0;
    const check = setInterval(() => {
      intentos++;
      // Nombres comunes que podría usar roprost-live.js
      const posiblesFn = ['guardarResultado', 'saveResult', 'onMatchEnd', 'finalizarPartido'];
      posiblesFn.forEach(nombre => {
        if (typeof window[nombre] === 'function' && !window[nombre].__rp_hooked) {
          const original = window[nombre];
          window[nombre] = function (datos) {
            const r = original.apply(this, arguments);
            // Intentar mapear los datos al formato de RoproResults
            if (datos) {
              RoproResults.guardar({
                matchId:     datos.id || datos.matchId || datos.match_id,
                local:       datos.local || datos.home || datos.homeTeam,
                visitante:   datos.visitante || datos.away || datos.awayTeam,
                competicion: datos.competicion || datos.league || datos.competition,
                pronostico:  datos.pronostico || datos.prediction || datos.pick,
                resultado:   datos.resultado || datos.score || datos.result,
                estado:      datos.estado || datos.status,
                fecha:       datos.fecha || datos.date,
                horaFin:     datos.horaFin || datos.endTime
              });
            }
            return r;
          };
          window[nombre].__rp_hooked = true;
        }
      });
      if (intentos >= MAX) clearInterval(check);
    }, 500);
  }

  /* ═══════════════════════════════════════════════════
   * INIT
   * ═══════════════════════════════════════════════════ */
  function init() {
    inyectarEstilos();
    hookearTabResultados();
    hookearLive();

    // Si ya hay un panel de resultados visible al cargar, renderizarlo
    setTimeout(() => {
      const panel = document.getElementById('rp-resultados-panel');
      if (panel) renderResultados(panel);
    }, 800);

    console.log('[RoproResults] ✅ Módulo cargado. API disponible en window.RoproResults');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
