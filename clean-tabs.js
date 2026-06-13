(() => {
  function run() {
    ["picks", "top"].forEach(id => {
      document.querySelectorAll(`[data-tab="${id}"]`).forEach(e => e.remove());
      document.getElementById(`panel-${id}`)?.remove();
    });
    const btns = [...document.querySelectorAll(".tab-btn")];
    const panels = [...document.querySelectorAll(".tab-panel")];
    if (!btns.length) return;
    const active = document.querySelector('[data-tab="cupon"]') || btns[0];
    const id = active.dataset.tab;
    btns.forEach(b => b.classList.toggle("active", b === active));
    panels.forEach(p => p.classList.toggle("active", p.id === `panel-${id}`));
  }
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", run);
  setTimeout(run, 500);
  setTimeout(run, 1500);
})();
