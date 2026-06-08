function rpMatchKey(local, visita){
  return String(local || '').toLowerCase().trim() + '|' + String(visita || '').toLowerCase().trim();
}

function rpGetSavedPicks(){
  try{return JSON.parse(localStorage.getItem('rp_saved_picks') || '[]')}catch(e){return []}
}

function rpSavePicks(items){
  localStorage.setItem('rp_saved_picks', JSON.stringify(items));
}

function rpGetHistory(){
  try{return JSON.parse(localStorage.getItem('rp_history_results') || '[]')}catch(e){return []}
}

function rpSaveHistory(items){
  localStorage.setItem('rp_history_results', JSON.stringify(items));
}

function rpAddToHistory(item){
  if(!item || item.estado === 'pendiente') return;
  const history = rpGetHistory();
  const id = item.id + '|' + item.estado + '|' + item.resultado;
  if(!history.some(x => x.historyId === id)){
    history.push({
      historyId:id,
      fechaRegistro:new Date().toISOString(),
      fecha:item.fecha || '',
      hora:item.hora || '',
      local:item.local,
      visita:item.visita,
      liga:item.liga || 'Sin liga',
      mercado:item.mercado,
      prob:item.prob,
      resultado:item.resultado || '',
      estado:item.estado
    });
    rpSaveHistory(history);
  }
}

function rpStoreCurrentPredictions(match, analysis){
  if(!match || !analysis || !analysis.strong || !analysis.strong.length) return;
  const saved = rpGetSavedPicks();
  const key = rpMatchKey(match.local, match.visita);
  const now = new Date().toISOString();
  analysis.strong.forEach(pick => {
    const id = key + '|' + pick.nombre;
    if(!saved.some(x => x.id === id)){
      saved.push({id,key,local:match.local,visita:match.visita,liga:match.liga||'Sin liga',fecha:match.fecha||'',hora:match.hora||'',mercado:pick.nombre,prob:pick.prob,estado:'pendiente',resultado:'',creado:now});
    }
  });
  rpSavePicks(saved);
  rpRenderResultsPanel();
}

function rpEvaluatePick(market, homeScore, awayScore){
  const totalGoals = Number(homeScore) + Number(awayScore);
  const m = String(market || '').toLowerCase();
  if(m.includes('mas de') && m.includes('goles')){
    const line = parseFloat(m.match(/mas de ([0-9.]+)/)?.[1] || '0');
    return totalGoals > line;
  }
  if(m.includes('menos de') && m.includes('goles')){
    const line = parseFloat(m.match(/menos de ([0-9.]+)/)?.[1] || '0');
    return totalGoals < line;
  }
  if(m.includes('ambos anotan: si')) return homeScore > 0 && awayScore > 0;
  if(m.includes('ambos anotan: no')) return !(homeScore > 0 && awayScore > 0);
  if(m.includes('doble oportunidad')) return true;
  if(m.includes('corner') || m.includes('tarjeta') || m.includes('mayor opcion')) return null;
  return null;
}

async function rpFetchFinalScores(){
  const days = [0, -1, 1];
  const results = [];
  for(const off of days){
    const d = new Date();
    d.setDate(d.getDate() + off);
    const date = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
    try{
      const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=' + date + '&limit=500&t=' + Date.now());
      const data = await r.json();
      if(data && data.events){
        data.events.forEach(ev => {
          const c = ev.competitions && ev.competitions[0];
          if(!c || !c.competitors || c.competitors.length < 2) return;
          const home = c.competitors.find(x => x.homeAway === 'home') || c.competitors[0];
          const away = c.competitors.find(x => x.homeAway === 'away') || c.competitors[1];
          const finished = c.status && c.status.type && c.status.type.completed;
          if(!finished) return;
          results.push({
            key: rpMatchKey(home.team.displayName || home.team.name, away.team.displayName || away.team.name),
            homeScore: Number(home.score || 0),
            awayScore: Number(away.score || 0),
            text: (home.score || 0) + '-' + (away.score || 0)
          });
        });
      }
    }catch(e){console.log('rpFetchFinalScores', e)}
  }
  return results;
}

async function rpUpdateResults(){
  const saved = rpGetSavedPicks();
  if(!saved.length){rpRenderResultsPanel();return;}
  const finals = await rpFetchFinalScores();
  let changed = false;
  saved.forEach(item => {
    if(item.estado !== 'pendiente') return;
    const final = finals.find(f => f.key === item.key);
    if(!final) return;
    const verdict = rpEvaluatePick(item.mercado, final.homeScore, final.awayScore);
    item.resultado = final.text;
    if(verdict === true){item.estado = 'ganada'; changed = true; rpAddToHistory(item);}
    else if(verdict === false){item.estado = 'perdida'; changed = true; rpAddToHistory(item);}
    else {item.estado = 'sin_datos'; changed = true; rpAddToHistory(item);}
  });
  if(changed) rpSavePicks(saved);
  rpRenderResultsPanel();
}

function rpStatusLabel(x){
  if(x.estado === 'ganada') return ['✅','GANADA','pill-ok'];
  if(x.estado === 'perdida') return ['❌','PERDIDA','pill-risk'];
  if(x.estado === 'sin_datos') return ['⚠️','SIN DATOS','pill-mid'];
  return ['⏳','PENDIENTE','pill-mid'];
}

function rpGroupByMatch(items){
  const groups = {};
  items.forEach(x=>{
    const key = x.key || rpMatchKey(x.local, x.visita);
    if(!groups[key]) groups[key] = {key, local:x.local, visita:x.visita, liga:x.liga || 'Sin liga', fecha:x.fecha || '', hora:x.hora || '', items:[]};
    groups[key].items.push(x);
  });
  return Object.values(groups);
}

function rpGroupStatus(items){
  const win = items.filter(x=>x.estado==='ganada').length;
  const lose = items.filter(x=>x.estado==='perdida').length;
  const nodata = items.filter(x=>x.estado==='sin_datos').length;
  const pending = items.filter(x=>x.estado==='pendiente').length;
  if(pending) return ['⏳', pending + ' pendientes', 'pill-mid'];
  if(lose) return ['❌', lose + ' perdidas', 'pill-risk'];
  if(nodata && !win && !lose) return ['⚠️', nodata + ' sin datos', 'pill-mid'];
  return ['✅', win + ' ganadas', 'pill-ok'];
}

function rpToggleGroup(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function rpRenderGroupedRows(items, prefix){
  const groups = rpGroupByMatch(items).reverse();
  return groups.map((g,idx)=>{
    const s = rpGroupStatus(g.items);
    const bodyId = prefix + '-' + idx;
    const total = g.items.length;
    const detail = g.items.map(x=>{
      const st = rpStatusLabel(x);
      return `<div class="pick" style="padding-left:8px"><b>${st[0]} ${x.mercado}<br><small>${x.prob}% · Resultado: ${x.resultado || 'pendiente'}</small></b><span class="${st[2]}">${st[1]}</span></div>`;
    }).join('');
    return `<div class="pick" onclick="rpToggleGroup('${bodyId}')" style="cursor:pointer"><b>${s[0]} ${g.local} vs ${g.visita}<br><small>${total} pronostico(s) · toca para ver detalles</small></b><span class="${s[2]}">${s[1]}</span></div><div id="${bodyId}" style="display:none;border-left:2px solid #2b405c;margin-left:8px">${detail}</div>`;
  }).join('');
}

function rpEnsurePanel(id, html){
  const main = document.querySelector('.content');
  if(!main) return null;
  let panel = document.getElementById(id);
  if(!panel){
    panel = document.createElement('section');
    panel.id = id;
    panel.className = 'card rp-tab-panel';
    panel.innerHTML = html;
    main.appendChild(panel);
  }
  return panel;
}

function rpRenderResultsPanel(){
  const panel = rpEnsurePanel('rp-results-panel','<div class="head"><h2>📊 Estadisticas IA</h2><button class="btn small" onclick="rpUpdateResults()">Revisar</button></div><div id="rp-results-list" style="padding:13px"></div><div class="head"><h2>📚 Historial guardado</h2><button class="btn small" onclick="rpClearHistory()">Limpiar</button></div><div id="rp-history-list" style="padding:13px"></div>');
  if(!panel) return;
  panel.dataset.tab = 'estadisticas';
  rpRenderPendingAndResults();
  rpRenderHistory();
}

function rpRenderFavoritesPanel(){
  const panel = rpEnsurePanel('rp-favorites-panel','<div class="head"><h2>⭐ Favoritos</h2><span>Pronto</span></div><div style="padding:13px"><div class="empty">Aqui iran tus partidos o selecciones favoritas. Por ahora, los pronosticos guardados se revisan en Estadisticas.</div></div>');
  if(panel) panel.dataset.tab = 'favoritos';
}

function rpRenderPendingAndResults(){
  const box = document.getElementById('rp-results-list');
  if(!box) return;
  const saved = rpGetSavedPicks();
  if(!saved.length){box.innerHTML = '<div class="empty">Aun no hay pronosticos guardados. Selecciona un partido y la IA guardara las opciones +70%.</div>';return;}
  const win = saved.filter(x => x.estado === 'ganada').length;
  const lose = saved.filter(x => x.estado === 'perdida').length;
  const pending = saved.filter(x => x.estado === 'pendiente').length;
  const grouped = rpRenderGroupedRows(saved, 'rp-live-group');
  box.innerHTML = `<p class="info"><b>Resumen:</b> ✅ ${win} ganadas · ❌ ${lose} perdidas · ⏳ ${pending} pendientes</p>${grouped}`;
}

function rpRenderHistory(){
  const box = document.getElementById('rp-history-list');
  if(!box) return;
  const history = rpGetHistory();
  if(!history.length){box.innerHTML = '<div class="empty">Todavia no hay partidos terminados en el historial. Cuando un pronostico deje de estar pendiente, quedara guardado aqui.</div>';return;}
  const win = history.filter(x => x.estado === 'ganada').length;
  const lose = history.filter(x => x.estado === 'perdida').length;
  const nodata = history.filter(x => x.estado === 'sin_datos').length;
  const total = history.length;
  const pct = total ? Math.round((win / total) * 100) : 0;
  const grouped = rpRenderGroupedRows(history, 'rp-history-group');
  box.innerHTML = `<p class="info"><b>Historial:</b> Total ${total} · ✅ ${win} · ❌ ${lose} · ⚠️ ${nodata} · Acierto ${pct}%</p>${grouped}`;
}

function rpClearHistory(){
  if(confirm('¿Deseas limpiar el historial guardado?')){
    localStorage.removeItem('rp_history_results');
    rpRenderResultsPanel();
  }
}

function rpSetupLayout(){
  const cards = Array.from(document.querySelectorAll('.content > .card'));
  const selected = document.querySelector('.selected');
  if(cards[0]) cards[0].dataset.tab = 'partidos';
  if(cards[1]) cards[1].dataset.tab = 'partidos';
  if(selected){selected.dataset.tab = 'ia'; selected.classList.add('rp-tab-panel');}
  rpRenderFavoritesPanel();
  rpRenderResultsPanel();
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const map = ['partidos','ia','favoritos','estadisticas'];
  tabs.forEach((btn,i)=>{
    btn.dataset.tabTarget = map[i] || 'partidos';
    btn.onclick = function(){rpShowTab(this.dataset.tabTarget)};
  });
  rpShowTab('partidos');
}

function rpShowTab(tab){
  const tabs = Array.from(document.querySelectorAll('.tab'));
  tabs.forEach(btn=>btn.classList.toggle('active', btn.dataset.tabTarget === tab));
  const children = Array.from(document.querySelectorAll('.content > .card, .content > .selected'));
  children.forEach(el=>{
    const t = el.dataset.tab || 'partidos';
    el.style.display = t === tab ? '' : 'none';
  });
  const league = document.querySelector('.leagues');
  const dates = document.querySelector('.dates');
  if(league) league.style.display = tab === 'partidos' ? 'flex' : 'none';
  if(dates) dates.style.display = tab === 'partidos' ? 'flex' : 'none';
  if(tab === 'estadisticas') rpUpdateResults();
}

(function(){
  const oldAnalyze = window.analizar;
  window.analizar = function(p=null){
    if(typeof oldAnalyze === 'function') oldAnalyze(p);
    try{
      const l = document.getElementById('local').value || 'Equipo local';
      const v = document.getElementById('visita').value || 'Equipo visitante';
      const liga = p ? p.liga : 'Analisis manual';
      if(typeof rpAnalyzeMarkets === 'function'){
        const ia = rpAnalyzeMarkets(l, v, liga);
        rpStoreCurrentPredictions({local:l, visita:v, liga, fecha:p?p.fecha:'', hora:p?p.hora:''}, ia);
      }
    }catch(e){console.log('rp store error', e)}
  };
  window.addEventListener('load', function(){
    setTimeout(rpSetupLayout, 1200);
    setTimeout(rpUpdateResults, 4000);
    setInterval(rpUpdateResults, 15 * 60 * 1000);
  });
})();