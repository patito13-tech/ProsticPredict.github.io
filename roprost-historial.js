/* =====================================================================
   ROPROST PREDICT — HISTORIAL / RENTABILIDAD DE PRONÓSTICOS
   (roprost-historial.js)

   Se enlaza con una sola línea en index.html, DESPUÉS de app-main.js:
       <script src="roprost-historial.js?v=1"></script>

   - Inyecta su propio CSS (todo aislado bajo #rp-hist, no choca con rp-style.css).
   - Reutiliza tus clases .bloque / .bloque-titulo / .eyebrow para el encabezado.
   - Guarda los resultados en el navegador (localStorage, clave rp_picks_v1).
   - La confiabilidad NO se inventa: si faltan datos, dice "Datos insuficientes".
   ===================================================================== */

(() => {
  "use strict";

  const KEY = "rp_picks_v1";
  const MIN_GLOBAL = 5;   // mín. picks finalizados para clasificar la página entera
  const MIN_DAY = 3;      // mín. por día para etiquetar un día del historial

  /* ---------------- CSS (aislado bajo #rp-hist) ---------------- */
  const CSS = `
  #rp-hist{
    --w:#27d07a; --l:#ef4757; --p:#f5a623;
    --surf:#161c24; --surf2:#1e2530; --bord:#2a333f;
    --txt:#e9eef4; --mut:#8c98a7; --faint:#5d6875;
    --rad:14px; --rad-sm:10px;
    color:var(--txt); font-variant-numeric:tabular-nums;
  }
  #rp-hist *{box-sizing:border-box;}
  #rp-hist .rp-trust{
    display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
    background:linear-gradient(135deg,var(--surf),var(--surf2));
    border:1px solid var(--bord);border-radius:var(--rad);padding:18px 22px;margin-bottom:18px;
  }
  #rp-hist .rp-trust .lbl{font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;}
  #rp-hist .rp-trust .val{font-size:26px;font-weight:800;margin-top:2px;letter-spacing:-.01em;}
  #rp-hist .rp-trust .pct{font-size:13px;color:var(--mut);}
  #rp-hist .rp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:8px;}
  #rp-hist .rp-stat{background:var(--surf);border:1px solid var(--bord);border-radius:var(--rad-sm);padding:14px 16px;}
  #rp-hist .rp-stat .sl{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px;}
  #rp-hist .rp-stat .sv{font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1;}
  #rp-hist .rp-stat .sf{font-size:11px;color:var(--faint);margin-top:6px;}
  #rp-hist .rp-stat.win .sv{color:var(--w);} #rp-hist .rp-stat.loss .sv{color:var(--l);} #rp-hist .rp-stat.pend .sv{color:var(--p);}
  #rp-hist .rp-h3{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);font-weight:600;margin:24px 0 12px;display:flex;align-items:center;gap:9px;}
  #rp-hist .rp-h3::before{content:"";width:16px;height:2px;background:var(--w);border-radius:2px;}
  #rp-hist .rp-day{background:var(--surf);border:1px solid var(--bord);border-radius:var(--rad);padding:18px 20px;}
  #rp-hist .rp-day .top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px;}
  #rp-hist .rp-day .date{font-size:17px;font-weight:700;}
  #rp-hist .rp-day .rows{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;}
  #rp-hist .rp-day .rl{font-size:11px;color:var(--mut);} #rp-hist .rp-day .rv{font-size:18px;font-weight:700;margin-top:3px;}
  #rp-hist .badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid transparent;white-space:nowrap;}
  #rp-hist .badge.muyalta{color:var(--w);background:rgba(39,208,122,.12);border-color:rgba(39,208,122,.35);}
  #rp-hist .badge.alta{color:#5fd6a0;background:rgba(39,208,122,.08);border-color:rgba(39,208,122,.25);}
  #rp-hist .badge.media{color:var(--p);background:rgba(245,166,35,.1);border-color:rgba(245,166,35,.3);}
  #rp-hist .badge.baja{color:var(--l);background:rgba(239,71,87,.1);border-color:rgba(239,71,87,.3);}
  #rp-hist .badge.insuf{color:var(--mut);background:var(--surf2);border-color:var(--bord);}
  #rp-hist .badge.pos{color:var(--w);background:rgba(39,208,122,.1);} #rp-hist .badge.neg{color:var(--l);background:rgba(239,71,87,.1);} #rp-hist .badge.neu{color:var(--mut);background:var(--surf2);}
  #rp-hist .rp-form{background:var(--surf);border:1px solid var(--bord);border-radius:var(--rad);padding:18px 20px;display:grid;gap:12px;grid-template-columns:1.4fr 1fr 1.4fr .7fr auto;align-items:end;}
  #rp-hist .fld{display:flex;flex-direction:column;gap:5px;}
  #rp-hist .fld label{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;}
  #rp-hist .fld input,#rp-hist .fld select{background:#0e1116;border:1px solid var(--bord);border-radius:var(--rad-sm);color:var(--txt);padding:10px 12px;font-size:14px;font-family:inherit;width:100%;}
  #rp-hist .fld input:focus,#rp-hist .fld select:focus{outline:2px solid var(--w);outline-offset:1px;}
  #rp-hist .rp-btn{background:var(--w);color:#04140b;border:none;border-radius:var(--rad-sm);padding:11px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;}
  #rp-hist .rp-btn:hover{filter:brightness(1.08);}
  #rp-hist .rp-btn.ghost{background:transparent;color:var(--mut);border:1px solid var(--bord);font-weight:600;}
  #rp-hist .rp-btn.ghost:hover{color:var(--txt);}
  #rp-hist .picks{display:flex;flex-direction:column;gap:9px;}
  #rp-hist .pick{position:relative;background:var(--surf);border:1px solid var(--bord);border-radius:var(--rad-sm);padding:13px 15px;display:grid;grid-template-columns:auto 1fr auto auto;gap:13px;align-items:center;}
  #rp-hist .pick.ganado{border-left:3px solid var(--w);} #rp-hist .pick.perdido{border-left:3px solid var(--l);} #rp-hist .pick.pendiente{border-left:3px solid var(--p);}
  #rp-hist .pick .dot{width:9px;height:9px;border-radius:50%;}
  #rp-hist .pick .dot.ganado{background:var(--w);} #rp-hist .pick .dot.perdido{background:var(--l);} #rp-hist .pick .dot.pendiente{background:var(--p);}
  #rp-hist .pick .m{min-width:0;} #rp-hist .pick .match{font-weight:700;font-size:15px;}
  #rp-hist .pick .meta{font-size:12px;color:var(--mut);margin-top:3px;}
  #rp-hist .pick .mkt{display:inline-block;font-size:11px;padding:2px 8px;border-radius:6px;background:var(--surf2);border:1px solid var(--bord);color:var(--txt);margin-right:7px;}
  #rp-hist .pick .states{display:flex;gap:5px;}
  #rp-hist .sbtn{border:1px solid var(--bord);background:#0e1116;color:var(--mut);border-radius:8px;padding:6px 9px;font-size:14px;cursor:pointer;line-height:1;}
  #rp-hist .sbtn.active.ganado{background:rgba(39,208,122,.15);border-color:var(--w);}
  #rp-hist .sbtn.active.perdido{background:rgba(239,71,87,.15);border-color:var(--l);}
  #rp-hist .sbtn.active.pendiente{background:rgba(245,166,35,.15);border-color:var(--p);}
  #rp-hist .del{background:none;border:none;color:var(--faint);cursor:pointer;font-size:15px;padding:4px;}
  #rp-hist .del:hover{color:var(--l);}
  #rp-hist .hist{display:flex;flex-direction:column;gap:8px;}
  #rp-hist .hrow{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:var(--surf);border:1px solid var(--bord);border-radius:var(--rad-sm);padding:12px 15px;}
  #rp-hist .hrow .hd{font-weight:700;font-size:14px;min-width:90px;}
  #rp-hist .hrow .hs{color:var(--mut);font-size:13px;flex:1;}
  #rp-hist .hrow .hs b.w{color:var(--w);} #rp-hist .hrow .hs b.l{color:var(--l);}
  #rp-hist .hrow .hp{font-weight:700;font-size:14px;min-width:48px;text-align:right;}
  #rp-hist .empty{text-align:center;color:var(--mut);padding:28px 14px;border:1px dashed var(--bord);border-radius:var(--rad-sm);font-size:14px;}
  #rp-hist .note{font-size:12px;color:var(--faint);margin-top:16px;line-height:1.6;border-top:1px solid var(--bord);padding-top:14px;}
  #rp-hist .note code{background:var(--surf2);padding:1px 6px;border-radius:5px;color:var(--mut);}
  .rp-hist-link{background:rgba(39,208,122,.12);color:#27d07a;border:1px solid rgba(39,208,122,.35);border-radius:999px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:14px;}
  .rp-hist-link:hover{background:rgba(39,208,122,.2);}
  @media (max-width:760px){
    #rp-hist .rp-form{grid-template-columns:1fr 1fr;}
    #rp-hist .pick{grid-template-columns:auto 1fr;grid-template-areas:"dot m" "states states";}
    #rp-hist .pick .dot{grid-area:dot;} #rp-hist .pick .m{grid-area:m;} #rp-hist .pick .states{grid-area:states;justify-content:flex-end;}
  }`;

  /* ---------------- utilidades ---------------- */
  const todayISO = () => new Date().toISOString().slice(0,10);
  const fmtDate = (iso) => { const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; };
  const id = () => Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  const esc = (s) => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY))||[]; } catch(e){ return []; } };
  const save = (p) => localStorage.setItem(KEY, JSON.stringify(p));

  function seedIfEmpty(){
    if(localStorage.getItem(KEY)!==null) return;
    const t=todayISO();
    const dd=(n)=>{const x=new Date();x.setDate(x.getDate()-n);return x.toISOString().slice(0,10);};
    const a=[]; const mk=(f,par,mer,pk,c,e)=>a.push({id:id(),fecha:f,partido:par,mercado:mer,pick:pk,cuota:c,estado:e});
    mk(t,"Real Madrid vs Sevilla","Goles","Más de 2.5",1.80,"ganado");
    mk(t,"Inter vs Lazio","Córners","Más de 8.5 córners",1.90,"ganado");
    mk(t,"Arsenal vs Brighton","Doble oportunidad","1X",1.40,"ganado");
    mk(t,"PSG vs Lyon","Goles","Ambos marcan",1.75,"ganado");
    mk(t,"Bayern vs Wolfsburg","Goles","Más de 1.5",1.30,"ganado");
    mk(t,"Atlético vs Getafe","Doble oportunidad","12",1.55,"ganado");
    mk(t,"Juventus vs Torino","Córners","Más de 9.5 córners",2.05,"perdido");
    mk(t,"Napoli vs Roma","Goles","Más de 3.5",2.40,"perdido");
    mk(dd(1),"Liverpool vs Everton","Goles","Más de 2.5",1.70,"ganado");
    mk(dd(1),"Milan vs Udinese","Doble oportunidad","1X",1.35,"ganado");
    mk(dd(1),"Dortmund vs Mainz","Goles","Ambos marcan",1.65,"ganado");
    mk(dd(1),"Chelsea vs Fulham","Córners","Más de 9.5 córners",1.95,"ganado");
    mk(dd(1),"Barcelona vs Cádiz","Doble oportunidad","1X",1.25,"ganado");
    mk(dd(1),"Roma vs Genoa","Goles","Más de 2.5",1.85,"perdido");
    mk(dd(2),"Man City vs Burnley","Goles","Más de 2.5",1.60,"ganado");
    mk(dd(2),"Betis vs Osasuna","Doble oportunidad","X2",1.70,"ganado");
    mk(dd(2),"Leipzig vs Bremen","Córners","Más de 8.5 córners",1.80,"ganado");
    mk(dd(2),"Villarreal vs Celta","Goles","Ambos marcan",1.75,"ganado");
    mk(dd(2),"Lazio vs Empoli","Goles","Más de 2.5",1.90,"perdido");
    mk(dd(2),"Lille vs Niza","Doble oportunidad","12",1.50,"perdido");
    mk(dd(2),"Sociedad vs Mallorca","Córners","Más de 9.5 córners",2.10,"perdido");
    save(a);
  }

  function reliability(fin,pct,umbral){
    if(fin<umbral) return {label:"Datos insuficientes",cls:"insuf"};
    if(pct>=80) return {label:"Muy alta",cls:"muyalta"};
    if(pct>=70) return {label:"Alta",cls:"alta"};
    if(pct>=60) return {label:"Media",cls:"media"};
    return {label:"Baja",cls:"baja"};
  }
  function compute(picks){
    const g=picks.filter(p=>p.estado==="ganado");
    const l=picks.filter(p=>p.estado==="perdido");
    const p=picks.filter(p=>p.estado==="pendiente");
    const fin=g.length+l.length;
    const pct=fin?(g.length/fin*100):null;
    const profit=g.reduce((s,x)=>s+((+x.cuota||0)-1),0)-l.length;
    return {g,l,p,fin,pct,profit};
  }
  function streak(picks){
    const fin=picks.filter(p=>p.estado!=="pendiente");
    if(!fin.length) return {n:0,type:null};
    const ord=fin.slice().reverse(); const type=ord[0].estado; let n=0;
    for(const x of ord){ if(x.estado===type) n++; else break; }
    return {n,type};
  }
  function bestPick(arr){
    if(!arr.length) return "—";
    let c=arr[0]; for(const x of arr){ if((+x.cuota||0)>(+c.cuota||0)) c=x; }
    return `${esc(c.partido)} <span style="color:var(--mut)">(${(+c.cuota).toFixed(2)})</span>`;
  }
  const statCard=(cls,l,v,f)=>`<div class="rp-stat ${cls}"><div class="sl">${l}</div><div class="sv">${v}</div><div class="sf">${f}</div></div>`;

  function renderPick(p){
    return `<div class="pick ${p.estado}">
      <span class="dot ${p.estado}"></span>
      <div class="m"><div class="match">${esc(p.partido)}</div>
        <div class="meta"><span class="mkt">${esc(p.mercado)}</span>${esc(p.pick)} · cuota ${(+p.cuota).toFixed(2)}</div></div>
      <div class="states">
        <button class="sbtn pendiente ${p.estado==='pendiente'?'active':''}" data-id="${p.id}" data-st="pendiente" title="Pendiente">⏳</button>
        <button class="sbtn ganado ${p.estado==='ganado'?'active':''}" data-id="${p.id}" data-st="ganado" title="Ganado">✅</button>
        <button class="sbtn perdido ${p.estado==='perdido'?'active':''}" data-id="${p.id}" data-st="perdido" title="Perdido">❌</button>
      </div>
      <button class="del" data-del="${p.id}" title="Eliminar">🗑</button>
    </div>`;
  }

  /* ---------------- render principal ---------------- */
  function render(root){
    const picks=load();
    const all=compute(picks);
    const today=todayISO();
    const tp=picks.filter(p=>p.fecha===today);
    const day=compute(tp);
    const st=streak(picks);
    const relG=reliability(all.fin, all.pct??0, MIN_GLOBAL);
    const relColor = relG.cls==="insuf"?"var(--mut)":relG.cls==="baja"?"var(--l)":relG.cls==="media"?"var(--p)":"var(--w)";
    const profTxt=(all.profit>0?"+":"")+all.profit.toFixed(2)+" u";
    const profCls=all.profit>0?"pos":all.profit<0?"neg":"neu";
    const profLbl=all.profit>0?"Positiva":all.profit<0?"Negativa":"Neutra";
    const relD=reliability(day.fin, day.pct??0, MIN_DAY);
    const dProf=(day.profit>0?"+":"")+day.profit.toFixed(2)+" u";
    const dProfLbl=day.profit>0?"Positiva":day.profit<0?"Negativa":"Neutra";

    // historial por días (sin hoy)
    const byDay={}; picks.forEach(p=>{ if(p.fecha!==today)(byDay[p.fecha]=byDay[p.fecha]||[]).push(p); });
    const days=Object.keys(byDay).sort().reverse();
    const histHtml = days.length ? days.map(d=>{
      const s=compute(byDay[d]); const r=reliability(s.fin,s.pct??0,MIN_DAY);
      const pct=s.pct===null?"—":s.pct.toFixed(0)+"%";
      return `<div class="hrow"><span class="hd">${fmtDate(d)}</span>
        <span class="hs"><b class="w">${s.g.length} ganadas</b> / <b class="l">${s.l.length} perdidas</b>${s.p.length?` · ${s.p.length} pend.`:""}</span>
        <span class="hp">${pct}</span><span class="badge ${r.cls}">${r.label}</span></div>`;
    }).join("") : `<div class="empty">El historial de días anteriores aparecerá aquí.</div>`;

    const todayHtml = tp.length ? tp.slice().reverse().map(renderPick).join("")
      : `<div class="empty">Aún no hay pronósticos de hoy. Registra el primero arriba.</div>`;

    root.innerHTML = `
      <h2 class="bloque-titulo"><span class="eyebrow">Confiabilidad real · día a día</span>Rentabilidad de Pronósticos</h2>

      <div class="rp-trust">
        <div><div class="lbl">Confiabilidad de la página</div>
          <div class="val" style="color:${relColor}">${relG.label}</div></div>
        <div class="pct">${all.fin<MIN_GLOBAL?`Faltan ${MIN_GLOBAL-all.fin} resultado(s) para clasificar`:`${all.pct.toFixed(1)}% de acierto · ${all.fin} finalizados`}</div>
      </div>

      <div class="rp-grid">
        ${statCard("win","Ganados",all.g.length,"finalizados con éxito")}
        ${statCard("loss","Perdidos",all.l.length,"resultados fallidos")}
        ${statCard("pend","Pendientes",all.p.length,"aún sin resultado")}
        ${statCard("","Total de picks",picks.length,"registrados en total")}
        ${statCard("","Acierto general",all.pct===null?"—":all.pct.toFixed(0)+"%",all.fin?`${all.g.length}/${all.fin} finalizados`:"sin finalizados")}
        ${statCard("","Racha actual",st.n?st.n:"0",st.type?(st.type==="ganado"?"ganadas seguidas":"perdidas seguidas"):"sin racha")}
        <div class="rp-stat"><div class="sl">Rentabilidad estimada</div><div class="sv" style="font-size:21px">${profTxt}</div><div class="sf"><span class="badge ${profCls}">${profLbl}</span></div></div>
      </div>

      <h3 class="rp-h3">📊 Resumen del día</h3>
      <div class="rp-day">
        <div class="top"><div class="date">Fecha: ${fmtDate(today)}</div><span class="badge ${relD.cls}">Confiabilidad: ${relD.label}</span></div>
        <div class="rows">
          <div><div class="rl">Realizados</div><div class="rv">${tp.length}</div></div>
          <div><div class="rl">Ganados</div><div class="rv" style="color:var(--w)">${day.g.length}</div></div>
          <div><div class="rl">Perdidos</div><div class="rv" style="color:var(--l)">${day.l.length}</div></div>
          <div><div class="rl">Pendientes</div><div class="rv" style="color:var(--p)">${day.p.length}</div></div>
          <div><div class="rl">Acierto del día</div><div class="rv">${day.pct===null?"—":day.pct.toFixed(0)+"%"}</div></div>
          <div><div class="rl">Rentabilidad</div><div class="rv" style="font-size:15px;color:${day.profit>0?'var(--w)':day.profit<0?'var(--l)':'var(--mut)'}">${dProf} · ${dProfLbl}</div></div>
          <div><div class="rl">🏆 Mejor pick</div><div class="rv" style="font-size:13px">${bestPick(day.g)}</div></div>
          <div><div class="rl">⚠️ Peor pick</div><div class="rv" style="font-size:13px">${bestPick(day.l)}</div></div>
        </div>
      </div>

      <h3 class="rp-h3">Registrar pronóstico</h3>
      <div class="rp-form">
        <div class="fld"><label>Partido</label><input id="rp-f-match" type="text" placeholder="Ej. Boca vs River" autocomplete="off"></div>
        <div class="fld"><label>Mercado</label><select id="rp-f-market"><option>Goles</option><option>Córners</option><option>Doble oportunidad</option></select></div>
        <div class="fld"><label>Pronóstico</label><input id="rp-f-pick" type="text" placeholder="Ej. Más de 2.5 goles" autocomplete="off"></div>
        <div class="fld"><label>Cuota</label><input id="rp-f-odd" type="number" step="0.01" min="1.01" value="1.85"></div>
        <button class="rp-btn" id="rp-add">Añadir pick</button>
      </div>

      <h3 class="rp-h3">Pronósticos de hoy</h3>
      <div class="picks">${todayHtml}</div>

      <h3 class="rp-h3">📅 Historial</h3>
      <div class="hist">${histHtml}</div>

      <div class="note">
        Marca cada pick con <code>✅</code> ganado, <code>❌</code> perdido o <code>⏳</code> pendiente. Solo los finalizados cuentan para el porcentaje:
        <code>ganados ÷ (ganados + perdidos) × 100</code>. La rentabilidad usa la cuota: <code>Σ(cuota−1) de ganados − nº de perdidos</code> (unidades).
        <button class="rp-btn ghost" id="rp-reset" style="margin-left:6px">Reiniciar datos</button>
      </div>`;

    // eventos
    root.querySelectorAll(".sbtn").forEach(b=>b.onclick=()=>{
      const ps=load(); const x=ps.find(z=>z.id===b.dataset.id);
      if(x){ x.estado=b.dataset.st; save(ps); render(root); }
    });
    root.querySelectorAll(".del").forEach(b=>b.onclick=()=>{
      save(load().filter(z=>z.id!==b.dataset.del)); render(root);
    });
    const add=root.querySelector("#rp-add");
    if(add) add.onclick=()=>{
      const match=root.querySelector("#rp-f-match").value.trim();
      const market=root.querySelector("#rp-f-market").value;
      const pick=root.querySelector("#rp-f-pick").value.trim();
      const odd=parseFloat(root.querySelector("#rp-f-odd").value);
      if(!match||!pick){ alert("Escribe el partido y el pronóstico."); return; }
      const ps=load();
      ps.push({id:id(),fecha:todayISO(),partido:match,mercado:market,pick:pick,cuota:(odd&&odd>1?odd:1.85),estado:"pendiente"});
      save(ps); render(root);
    };
    const rst=root.querySelector("#rp-reset");
    if(rst) rst.onclick=()=>{ if(confirm("¿Borrar todos los pronósticos guardados?")){ localStorage.removeItem(KEY); render(root); } };
  }

  /* ---------------- inserción en la página ---------------- */
  function injectStyle(){
    if(document.getElementById("rp-hist-css")) return;
    const s=document.createElement("style"); s.id="rp-hist-css"; s.textContent=CSS;
    document.head.appendChild(s);
  }

  function mount(){
    const app=document.getElementById("app");
    if(!app || document.getElementById("rp-hist")) return false;
    const sec=document.createElement("section");
    sec.className="bloque"; sec.id="rp-hist";
    const footer=app.querySelector(".pie");
    if(footer) app.insertBefore(sec,footer); else app.appendChild(sec);
    render(sec);

    // botón en el hero que baja hasta la sección
    const hero=app.querySelector(".hero");
    if(hero && !hero.querySelector(".rp-hist-link")){
      const btn=document.createElement("button");
      btn.className="rp-hist-link"; btn.textContent="📊 Ver rentabilidad de pronósticos";
      btn.onclick=()=>sec.scrollIntoView({behavior:"smooth"});
      hero.appendChild(btn);
    }
    return true;
  }

  function start(){
    seedIfEmpty(); injectStyle();
    if(mount()) return;
    // la app de Roprost se carga async: esperamos a que #app tenga contenido (.pie)
    let tries=0;
    const iv=setInterval(()=>{
      tries++;
      const app=document.getElementById("app");
      if((app && app.querySelector(".pie")) || tries>40){ clearInterval(iv); mount(); }
    },200);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",start);
  else start();
})();
