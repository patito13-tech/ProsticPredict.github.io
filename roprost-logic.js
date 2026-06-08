function rpPickBase(base, alternativas){
  if(base.prob >= 70) return base;
  for(const alt of alternativas){
    if(alt.prob >= 70) return alt;
  }
  return base;
}

function rpQuality(name){
  const n = String(name || '').toLowerCase();
  const strong = ['france','francia','spain','espana','españa','brazil','brasil','argentina','england','inglaterra','germany','alemania','portugal','italy','italia','real madrid','barcelona','manchester city','liverpool','arsenal','psg','bayern','inter','juventus','napoli','chelsea','tottenham','atletico','dortmund','benfica'];
  let score = 50;
  strong.forEach(team => { if(n.includes(team)) score += 18; });
  return Math.min(score + (n.length % 9), 88);
}

function rpClassProb(p){
  return p >= 70 ? 'pill-ok' : p >= 60 ? 'pill-mid' : 'pill-risk';
}

function rpRiskClass(r){
  return r === 'Bajo' ? 'good' : r === 'Medio' ? 'warn' : 'pill-risk';
}

function rpClamp(n,min,max){return Math.max(min,Math.min(max,Math.round(n)))}

function rpProStats(local,away,league){
  const ql=rpQuality(local), qv=rpQuality(away), dif=ql-qv;
  const top=/champions|world|cup|premier|laliga|serie|international|amistoso|libertadores|sudamericana|uefa|fifa|mundial/i.test(String(league||''));
  const openGame=top||Math.abs(dif)>14;
  const homeAdv=6;
  const xgLocal=Math.max(.55,Math.min(2.65,1.18+(ql-50)*.026-(qv-50)*.014+homeAdv*.01+(top?.08:0)));
  const xgAway=Math.max(.45,Math.min(2.45,1.02+(qv-50)*.025-(ql-50)*.013+(top?.07:0)));
  const totalXg=xgLocal+xgAway;
  const over15=rpClamp(48+totalXg*13+(openGame?6:0),52,88);
  const over25=rpClamp(31+totalXg*12+(openGame?5:0),38,78);
  const btts=rpClamp(34+(Math.min(xgLocal,xgAway)*22)+(openGame?4:0),38,75);
  const corners=rpClamp(54+totalXg*7+(top?4:0),58,84);
  const cards=rpClamp(50+(top?11:4)+(Math.abs(dif)<9?5:0),54,82);
  const localP=rpClamp(48+dif*.46+homeAdv,22,74);
  const awayP=rpClamp(40-dif*.43,18,70);
  const drawP=rpClamp(100-localP-awayP,16,34);
  const favorite=localP>=awayP?local:away;
  const favP=Math.max(localP,awayP);
  const closeGame=Math.abs(localP-awayP)<9;
  const risk=closeGame?'Alto':Math.abs(localP-awayP)<17?'Medio':'Bajo';
  const confidence=risk==='Bajo'?'Alta':risk==='Medio'?'Media':'Moderada';
  return {ql,qv,dif,top,openGame,xgLocal:+xgLocal.toFixed(2),xgAway:+xgAway.toFixed(2),totalXg:+totalXg.toFixed(2),over15,over25,btts,corners,cards,localP,awayP,drawP,favorite,favP,closeGame,risk,confidence};
}

function rpAnalyzeMarkets(local, away, league){
  const s=rpProStats(local,away,league);
  const result = rpPickBase(
    {nombre:'Doble oportunidad', prob:Math.min(88, s.favP + (s.closeGame ? 14 : 22))},
    [
      {nombre:'Empate o ' + s.favorite, prob:Math.min(86, s.favP + 18)},
      {nombre:'Mayor opcion: ' + s.favorite, prob:s.favP}
    ]
  );
  const goals = rpPickBase({nombre:'Mas de 1.5 goles', prob:s.over15},[
    {nombre:'Mas de 0.5 goles', prob:90},
    {nombre:'Menos de 4.5 goles', prob:rpClamp(84-(s.totalXg-2)*3,72,88)},
    {nombre:'Mas de 2.5 goles', prob:s.over25}
  ]);
  const corners = rpPickBase({nombre:'Mas de 6.5 corners', prob:s.corners-6},[
    {nombre:'Mas de 5.5 corners', prob:s.corners},
    {nombre:'Mas de 4.5 corners', prob:Math.min(86,s.corners+8)},
    {nombre:'Menos de 11.5 corners', prob:76}
  ]);
  const cards = rpPickBase({nombre:'Mas de 2.5 tarjetas', prob:s.cards-4},[
    {nombre:'Mas de 1.5 tarjetas', prob:Math.min(84,s.cards+4)},
    {nombre:'Menos de 6.5 tarjetas', prob:78},
    {nombre:'Menos de 5.5 tarjetas', prob:70}
  ]);
  const both = rpPickBase({nombre:'Ambos anotan: Si', prob:s.btts},[
    {nombre:'Ambos anotan: No', prob:s.closeGame ? 57 : rpClamp(72-s.btts/3,55,68)}
  ]);
  const recommended=[goals,corners,result,cards,both].filter(x=>x&&x.prob>=55).sort((a,b)=>b.prob-a.prob);
  const strong=recommended.filter(x=>x.prob>=70).sort((a,b)=>b.prob-a.prob);
  return {localP:s.localP,awayP:s.awayP,drawP:s.drawP,recommended,strong,best:recommended[0],risk:s.risk,confidence:s.confidence,stats:s};
}

function rpRenderStrong(items){
  const box = document.getElementById('strongList');
  if(!box) return;
  if(!items || !items.length){
    box.className = 'strong-empty';
    box.innerHTML = 'No hay opciones +70% para este partido.';
    return;
  }
  box.className = '';
  box.innerHTML = items.map((m,i) => `<div class="strong-item"><b>${i+1}. ${m.nombre}</b><span class="pill-ok">${m.prob}%</span></div>`).join('');
}

function rpProAnalysisHtml(local,away,ia){
  const s=ia.stats||{};
  const value=(ia.best&&ia.best.prob>=72)?'ALTO':(ia.best&&ia.best.prob>=65)?'MEDIO':'BAJO';
  const motivos=[];
  if(s.totalXg>=2.55)motivos.push('Proyección ofensiva alta por xG estimado.');
  if(s.over15>=70)motivos.push('Tendencia favorable a goles, especialmente +1.5.');
  if(Math.abs(s.localP-s.awayP)>=15)motivos.push('Existe diferencia clara entre favorito y rival.');
  if(s.closeGame)motivos.push('Partido parejo: conviene evitar ganador directo y priorizar mercados seguros.');
  if(s.corners>=70)motivos.push('Volumen esperado de ataque compatible con córners.');
  if(s.cards>=70)motivos.push('Riesgo competitivo suficiente para tarjetas.');
  return `<div class="rp-pro-box"><h3>🔥 Motor Roprost Pro IA</h3><div class="rp-pro-grid"><div><small>xG ${local}</small><b>${s.xgLocal||'--'}</b></div><div><small>xG ${away}</small><b>${s.xgAway||'--'}</b></div><div><small>Total xG</small><b>${s.totalXg||'--'}</b></div><div><small>Over 1.5</small><b>${s.over15||'--'}%</b></div><div><small>Ambos anotan</small><b>${s.btts||'--'}%</b></div><div><small>Value IA</small><b>${value}</b></div></div><p><b>Lectura IA:</b> ${motivos.join(' ')||'Partido con señales mixtas; se recomienda usar solo mercados con mayor porcentaje.'}</p></div>`;
}

function analizar(p=null){
  const l = p ? p.local : (document.getElementById('local')?.value || 'Equipo local');
  const v = p ? p.visita : (document.getElementById('visita')?.value || 'Equipo visitante');
  const liga = p ? p.liga : 'Analisis manual';
  const ia = rpAnalyzeMarkets(l, v, liga);

  document.getElementById('nombreLocal').innerText = l;
  document.getElementById('nombreVisita').innerText = v;
  document.getElementById('pLocal').innerText = ia.localP + '%';
  document.getElementById('pVisita').innerText = ia.awayP + '%';
  document.getElementById('pEmpate').innerText = ia.drawP + '%';
  document.getElementById('detallePartido').innerText = p ? (p.liga + ' · ' + p.hora + ' · ' + p.fuente) : 'Analisis manual';
  document.getElementById('analisisTexto').innerHTML = rpProAnalysisHtml(l,v,ia);
  document.getElementById('iaNivel').innerText = 'Confianza ' + ia.confidence;
  document.getElementById('mejorPick').innerText = ia.best ? ia.best.nombre + ' · ' + ia.best.prob + '%' : 'Sin mercado fuerte';
  document.getElementById('boxConfianza').innerText = ia.confidence;
  document.getElementById('boxRiesgo').innerText = ia.risk;
  document.getElementById('boxRiesgo').className = rpRiskClass(ia.risk);
  document.getElementById('listaPicks').innerHTML = ia.recommended.map(m => `<div class="pick"><b>${m.nombre}</b><span class="${rpClassProb(m.prob)}">${m.prob}%</span></div>`).join('');
  rpRenderStrong(ia.strong);
  document.getElementById('senales').innerHTML = '<b>Señales Pro IA:</b> Mejor jugada: ' + (ia.best ? ia.best.nombre : 'sin opcion clara') + '. Confianza ' + ia.confidence + ', riesgo ' + ia.risk + '. xG total estimado ' + ia.stats.totalXg + ', Over 1.5 ' + ia.stats.over15 + '%, BTTS ' + ia.stats.btts + '%.';
}
