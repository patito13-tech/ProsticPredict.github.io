/* =====================================================================
   ROPROST PREDICT — FILTROS EN RESULTADOS
   Separa el historial en: Todos, Ganados, Perdidos y En vivo.
   ===================================================================== */

(() => {
  "use strict";

  function inyectarEstilos() {
    if (document.getElementById("rp-historial-filtros-style")) return;

    const style = document.createElement("style");
    style.id = "rp-historial-filtros-style";
    style.textContent = `
      .historial-filtros{
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        margin:14px 0 16px;
      }
      .hist-filter{
        border:1px solid rgba(255,255,255,.12);
        background:rgba(255,255,255,.045);
        color:rgba(255,255,255,.72);
        border-radius:999px;
        padding:8px 12px;
        font:inherit;
        font-size:.82rem;
        font-weight:700;
        cursor:pointer;
        transition:.2s ease;
      }
      .hist-filter:hover{
        border-color:rgba(52,211,153,.35);
        color:#fff;
      }
      .hist-filter.active{
        background:linear-gradient(135deg,rgba(52,211,153,.95),rgba(16,185,129,.85));
        border-color:rgba(52,211,153,.9);
        color:#06120d;
        box-shadow:0 0 18px rgba(52,211,153,.25);
      }
      .historial-vacio-filtro{
        border:1px dashed rgba(255,255,255,.12);
        border-radius:12px;
        padding:18px;
        color:rgba(255,255,255,.48);
        text-align:center;
        font-size:.88rem;
        display:none;
      }
    `;
    document.head.appendChild(style);
  }

  function estadoDeCard(card) {
    if (card.classList.contains("acertado")) return "acertado";
    if (card.classList.contains("fallado")) return "fallado";
    if (card.classList.contains("vivo")) return "vivo";
    if (card.classList.contains("pendiente")) return "pendiente";
    return "pendiente";
  }

  function aplicarFiltro(filtro) {
    const cards = [...document.querySelectorAll("#panel-historial .historial-card")];
    let visibles = 0;

    cards.forEach(card => {
      const estado = estadoDeCard(card);
      const mostrar = filtro === "todos" || estado === filtro;
      card.style.display = mostrar ? "" : "none";
      if (mostrar) visibles++;
    });

    const vacio = document.querySelector("#panel-historial .historial-vacio-filtro");
    if (vacio) vacio.style.display = visibles ? "none" : "block";
  }

  function activarBotones() {
    const botones = [...document.querySelectorAll("#panel-historial .hist-filter")];
    if (!botones.length) return;

    botones.forEach(btn => {
      btn.onclick = () => {
        const filtro = btn.dataset.filter || "todos";
        botones.forEach(b => b.classList.toggle("active", b === btn));
        aplicarFiltro(filtro);
      };
    });
  }

  function crearFiltros() {
    const panel = document.querySelector("#panel-historial");
    if (!panel) return;

    const lista = panel.querySelector(".historial-lista");
    if (!lista) return;

    if (panel.querySelector(".historial-filtros")) {
      activarBotones();
      return;
    }

    const filtros = document.createElement("div");
    filtros.className = "historial-filtros";
    filtros.innerHTML = `
      <button class="hist-filter active" data-filter="todos">Todos</button>
      <button class="hist-filter" data-filter="acertado">Ganados</button>
      <button class="hist-filter" data-filter="fallado">Perdidos</button>
      <button class="hist-filter" data-filter="vivo">En vivo</button>
    `;

    const resumen = panel.querySelector(".historial-resumen");
    if (resumen) resumen.insertAdjacentElement("afterend", filtros);
    else lista.insertAdjacentElement("beforebegin", filtros);

    const vacio = document.createElement("p");
    vacio.className = "historial-vacio-filtro";
    vacio.textContent = "No hay pronósticos en esta categoría.";
    lista.insertAdjacentElement("beforebegin", vacio);

    activarBotones();
  }

  function iniciar() {
    inyectarEstilos();
    crearFiltros();

    document.addEventListener("click", (ev) => {
      const tab = ev.target.closest(".tab-btn");
      if (tab && tab.dataset.tab === "historial") {
        setTimeout(crearFiltros, 50);
      }
    });

    setTimeout(crearFiltros, 300);
    setTimeout(crearFiltros, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
