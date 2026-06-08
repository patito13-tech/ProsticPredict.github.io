function rpMatchKey(local, visita){
  return String(local || '').toLowerCase().trim() + '|' + String(visita || '').toLowerCase().trim();
}

function rpGetSavedPicks(){
  try{return JSON.parse(localStorage.getItem('rp_saved_picks') || '[]')}catch(e){return []}
}

function rpSavePicks(items){
  localStorage.setItem('rp_saved_picks', JSON.stringify(items));
}

function rpStoreCurrentPredictions(match, analysis){
  if(!match || !analysis || !analysis.strong || !analysis.strong.length) return;
  const saved = rpGetSavedPicks();
  const key = rpMatchKey(match.local, match.visita);
  const now = new Date().toISOString();
  analysis.strong.forEach(pick => {
    const id = key + '|' + pick.nombre;
    if(!saved.some(x => x.id === id)){
      saved.push({
        id,
        key,
        local: match.local,
        visita: match.visita,
        liga: match.liga || 'Sin liga',
        fecha: match.fecha || '',
        hora: match.hora || '',
        mercado: pick.nombre,
        prob: pick.prob,
        estado: 'pendiente',
        resultado: '',
        creado: now
      });
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
  if(m.includes('mayor opcion')) return null;
  if(m.includes('corner') || m.includes('tarjeta')) return null;
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
    if(verdict === true){item.estado = 'ganada'; changed = true;}
    else if(verdict === false){item.estado = 'perdida'; changed = true;}
    else {item.estado = 'sin_datos'; changed = true;}
  });
  if(changed) rpSavePicks(saved);
  rpRenderResultsPanel();
}

function rpRenderResultsPanel(){
  const main = document.querySelector('.content');
  if(!main) return;
  let panel = document.getElementById('rp-results-panel');
  if(!panel){
    panel = document.createElement('section');
    panel.id = 'rp-results-panel';
    panel.className = 'card';
    panel.innerHTML = '<div class="head"><h2>📋 Resultados de pronosticos IA</h2><button class="btn small" onclick="rpUpdateResults()">Revisar</button></div><div id="rp-results-list" style="padding:13px"></div>';
    main.appendChild(panel);
  }
  const box = document.getElementById('rp-results-list');
  const saved = rpGetSavedPicks().slice().reverse();
  if(!saved.length){box.innerHTML = '<div class="empty">Aun no hay pronosticos guardados. Selecciona un partido y la IA guardara las opciones +70%.</div>';return;}
  const win = saved.filter(x => x.estado === 'ganada').length;
  const lose = saved.filter(x => x.estado === 'perdida').length;
  const pending = saved.filter(x => x.estado === 'pendiente').length;
  const rows = saved.slice(0,20).map(x => {
    const icon = x.estado === 'ganada' ? '✅' : x.estado === 'perdida' ? '❌' : x.estado === 'sin_datos' ? '⚠️' : '⏳';
    const status = x.estado === 'ganada' ? 'GANADA' : x.estado === 'perdida' ? 'PERDIDA' : x.estado === 'sin_datos' ? 'SIN DATOS' : 'PENDIENTE';
    return `<div class="pick"><b>${icon} ${x.local} vs ${x.visita}<br><small>${x.mercado} · ${x.prob}% · Resultado: ${x.resultado || 'pendiente'}</small></b><span class="${x.estado==='ganada'?'pill-ok':x.estado==='perdida'?'pill-risk':'pill-mid'}">${status}</span></div>`;
  }).join('');
  box.innerHTML = `<p class="info"><b>Resumen:</b> ✅ ${win} ganadas · ❌ ${lose} perdidas · ⏳ ${pending} pendientes</p>${rows}`;
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
    setTimeout(rpRenderResultsPanel, 1500);
    setTimeout(rpUpdateResults, 4000);
    setInterval(rpUpdateResults, 15 * 60 * 1000);
  });
})();