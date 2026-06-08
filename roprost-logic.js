function rpPickBase(base, alternativas){
  if(base.prob >= 70) return base;
  for(const alt of alternativas){
    if(alt.prob >= 70) return alt;
  }
  return base;
}

function rpQuality(name){
  const n = String(name || '').toLowerCase();
  const strong = ['france','francia','spain','espana','españa','brazil','brasil','argentina','england','inglaterra','germany','alemania','portugal','italy','italia','real madrid','barcelona','manchester city','liverpool','arsenal','psg','bayern','inter','juventus'];
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

function rpAnalyzeMarkets(local, away, league){
  const ql = rpQuality(local);
  const qv = rpQuality(away);
  const dif = ql - qv;
  const top = /champions|world|cup|premier|laliga|serie|international|amistoso|libertadores|uefa/i.test(String(league || ''));
  const openGame = top || Math.abs(dif) > 16;

  let localP = Math.max(22, Math.min(72, Math.round(50 + dif * 0.42)));
  let awayP = Math.max(20, Math.min(68, Math.round(42 - dif * 0.42)));
  let drawP = Math.max(16, Math.min(34, 100 - localP - awayP));

  const favorite = localP >= awayP ? local : away;
  const favP = Math.max(localP, awayP);
  const closeGame = Math.abs(localP - awayP) < 9;
  const risk = closeGame ? 'Alto' : Math.abs(localP - awayP) < 17 ? 'Medio' : 'Bajo';
  const confidence = risk === 'Bajo' ? 'Alta' : risk === 'Medio' ? 'Media' : 'Moderada';

  const result = rpPickBase(
    {nombre:'Doble oportunidad', prob:Math.min(86, favP + (closeGame ? 14 : 22))},
    [
      {nombre:'Empate o ' + favorite, prob:Math.min(84, favP + 18)},
      {nombre:'Mayor opcion: ' + favorite, prob:favP}
    ]
  );

  const goalsBase = {nombre:'Mas de 1.5 goles', prob:openGame ? 70 : 61};
  const goals = rpPickBase(goalsBase, [
    {nombre:'Mas de 0.5 goles', prob:88},
    {nombre:'Menos de 4.5 goles', prob:78},
    {nombre:'Menos de 3.5 goles', prob:closeGame ? 74 : 68}
  ]);

  const cornersBase = {nombre:'Mas de 6.5 corners', prob:openGame ? 64 : 55};
  const corners = rpPickBase(cornersBase, [
    {nombre:'Mas de 5.5 corners', prob:openGame ? 72 : 65},
    {nombre:'Mas de 4.5 corners', prob:80},
    {nombre:'Menos de 11.5 corners', prob:76},
    {nombre:'Menos de 10.5 corners', prob:70}
  ]);

  const cardsBase = {nombre:'Mas de 2.5 tarjetas', prob:top ? 62 : 54};
  const cards = rpPickBase(cardsBase, [
    {nombre:'Mas de 1.5 tarjetas', prob:75},
    {nombre:'Menos de 6.5 tarjetas', prob:78},
    {nombre:'Menos de 5.5 tarjetas', prob:70}
  ]);

  const bothBase = {nombre:'Ambos anotan: Si', prob:openGame ? 60 : 52};
  const both = rpPickBase(bothBase, [
    {nombre:'Ambos anotan: No', prob:closeGame ? 56 : 63}
  ]);

  const recommended = [goals, corners, result, cards, both].filter(x => x && x.prob >= 55).sort((a,b) => b.prob - a.prob);
  const strong = recommended.filter(x => x.prob >= 70).sort((a,b) => b.prob - a.prob);

  return {localP, awayP, drawP, recommended, strong, best:recommended[0], risk, confidence};
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

function analizar(p=null){
  const l = document.getElementById('local').value || 'Equipo local';
  const v = document.getElementById('visita').value || 'Equipo visitante';
  const liga = p ? p.liga : 'Analisis manual';
  const ia = rpAnalyzeMarkets(l, v, liga);

  document.getElementById('nombreLocal').innerText = l;
  document.getElementById('nombreVisita').innerText = v;
  document.getElementById('pLocal').innerText = ia.localP + '%';
  document.getElementById('pVisita').innerText = ia.awayP + '%';
  document.getElementById('pEmpate').innerText = ia.drawP + '%';
  document.getElementById('detallePartido').innerText = p ? (p.liga + ' · ' + p.hora + ' · ' + p.fuente) : 'Analisis manual';
  document.getElementById('analisisTexto').innerText = 'IA Roprost mantiene la linea base si ya llega a 70%. Solo ajusta las que no alcanzan ese nivel.';
  document.getElementById('iaNivel').innerText = 'Confianza ' + ia.confidence;
  document.getElementById('mejorPick').innerText = ia.best ? ia.best.nombre + ' · ' + ia.best.prob + '%' : 'Sin mercado fuerte';
  document.getElementById('boxConfianza').innerText = ia.confidence;
  document.getElementById('boxRiesgo').innerText = ia.risk;
  document.getElementById('boxRiesgo').className = rpRiskClass(ia.risk);
  document.getElementById('listaPicks').innerHTML = ia.recommended.map(m => `<div class="pick"><b>${m.nombre}</b><span class="${rpClassProb(m.prob)}">${m.prob}%</span></div>`).join('');
  rpRenderStrong(ia.strong);
  document.getElementById('senales').innerHTML = '<b>Senales IA:</b> Mejor jugada: ' + (ia.best ? ia.best.nombre : 'sin opcion clara') + '. Confianza ' + ia.confidence + ', riesgo ' + ia.risk + '. Solo se ajustaron las lineas que no llegaban a 70%.';
}