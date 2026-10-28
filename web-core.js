(()=>{'use strict';
const $=id=>document.getElementById(id), KEY='sportka_web_v1', DIRTY='sportka_dirty_v1', CFG='sportka_github_config', REMOTE='sportka-data.json';
const initial=()=>({history:[],bets:[],predictions:[],version:1});let data;try{data=JSON.parse(localStorage.getItem(KEY))||initial()}catch{data=initial()}
// Kompatibilita se starsimi zalohami: pouze omezeni poctu predikci, bez zmeny sazkovych a losovacich dat.
const limitPredictions=d=>{if(Array.isArray(d?.predictions)&&d.predictions.length>6)d.predictions=d.predictions.slice(0,6);return d};
limitPredictions(data);
let cfg;try{cfg=JSON.parse(localStorage.getItem(CFG)||sessionStorage.getItem(CFG)||'{}')||{}}catch{cfg={}}if(cfg.owner&&cfg.repo&&cfg.token){localStorage.setItem(CFG,JSON.stringify(cfg));sessionStorage.removeItem(CFG)}let sha=null,dirty=localStorage.getItem(DIRTY)==='1',saving=false,timer,revision=0,conflict=false,polling=false;const SYNC_MS=15000;
let toastTimer;const info=(s,bad=false)=>{const status=$('status');status.textContent=s;status.style.color=bad?'#ff8888':'#ffd27b';if(/^(?:GitHub:|Synchronizace:)/i.test(s)){syncStatus(s.replace(/^GitHub:\s*/i,''),bad?'error':'ok');return;}const el=$('sportkaToast');if(!el)return;let type=/(?:už|již) obsahuje 6 čísel|chybí \d+ (?:číslo|čísla|čísel)|pro uložení musí mít každá kombinace/i.test(s)?'warning':bad?'error':/žádné|není co|nejsou nové|vyber|upozornění/i.test(s)?'warning':/vygenerováno|generování/i.test(s)?'info':/vyhodnoceno|uložena|uloženo|synchronizována|načteny|provedena|vrácena/i.test(s)?'success':'info';el.textContent=s;el.className='sportka-toast '+type+' visible';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),bad?4500:3000)};
// Jediny stavovy indikator synchronizace: vlevo dole, bez stredoveho toastu.
let syncState='init';
function syncStatus(message,kind='info'){
 const el=$('githubIndicator');if(!el)return;
 el.textContent=(kind==='ok'?'✓ ':kind==='error'?'⚠ ':'↻ ')+message;
 el.classList.toggle('synced',kind==='ok');
 el.classList.toggle('local-change',kind==='info');
 el.classList.toggle('sync-success',false);
 el.classList.toggle('error',kind==='error');
 el.style.color=kind==='ok'?'#9be3a5':kind==='error'?'#ffbf69':'#8bb7f0';
 el.title='GitHub: '+message;
}
const syncSignal=ok=>{syncState=ok?'ok':'error';syncStatus(ok?'data synchronizována':'chyba synchronizace',ok?'ok':'error')};
const store=()=>localStorage.setItem(KEY,JSON.stringify(data));const config=()=>cfg.owner&&cfg.repo&&cfg.token;
const persist=()=>{revision++;dirty=true;conflict=false;localStorage.setItem(DIRTY,'1');store();syncState='dirty';syncStatus(config()?'místní změny čekají na odeslání':'místní změny, GitHub nepřipojen',config()?'info':'error');if(config()){clearTimeout(timer);timer=setTimeout(()=>autosave().catch(e=>{syncStatus(e.message,'error')}),1500)}};
// Historie uživatelských změn v rámci aktuálního otevření aplikace.
const undoStack=[],redoStack=[],LIMIT=40;
const snapshot=()=>JSON.stringify(data);
function updateUndoButtons(){ $('undo').disabled=!undoStack.length; $('redo').disabled=!redoStack.length }
function checkpoint(){undoStack.push(snapshot());if(undoStack.length>LIMIT)undoStack.shift();redoStack.length=0;updateUndoButtons()}
function clearUndo(){undoStack.length=0;redoStack.length=0;updateUndoButtons()}
function travel(from,to,label){if(!from.length)return;to.push(snapshot());data=limitPredictions(JSON.parse(from.pop()));persist();render();updateUndoButtons();info(label)}
const date=s=>{s=String(s||'').trim();let m=s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:s.slice(0,10)};
const valid=a=>{let n=(Array.isArray(a)?a:String(a||'').split(',')).map(Number);return n.length===6&&new Set(n).size===6&&n.every(x=>Number.isInteger(x)&&x>=1&&x<=49)?n.sort((a,b)=>a-b):null};
const key=a=>valid(a)?.join(',');const parseCSV=s=>s.replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(r=>r.split(';'));
function parseHistory(s){let rows=parseCSV(s),out=[];if(!rows[0]?.[0]?.toLowerCase().includes('datum'))throw Error('Neplatná hlavička sportka.csv');for(let r of rows.slice(1)){if(r.length<18)continue;let a=valid(r.slice(4,10)),b=valid(r.slice(11,17)),x=+r[10],y=+r[17],d=date(r[0]);if(!a||!b||!d||!(x>=1&&x<=49&&!a.includes(x))||!(y>=1&&y<=49&&!b.includes(y)))continue;out.push({date:d,draws:[{numbers:a,bonus:x},{numbers:b,bonus:y}]})}if(!out.length)throw Error('Historie neobsahuje platné losování.');return [...new Map(out.map(h=>[h.date,h])).values()].sort((a,b)=>a.date.localeCompare(b.date))}
function parseBets(s){let rows=parseCSV(s),head=rows.shift().map(x=>x.toLowerCase().trim());return rows.map((r,i)=>{let o=Object.fromEntries(head.map((h,j)=>[h,r[j]||''])),n=valid(o.kombinace||o.kombinace_sportka);if(!n)return null;return {date:date(o.datum||o.datum_sazky),numbers:n,result:o.vysledek||'Nevyhodnoceno',method:o.metoda||'Python AI metoda',amount:o.castka||'0',order:i+1,hits1:o['tah 1']||'',hits2:o['tah 2']||''}}).filter(Boolean)}
function mergeHistory(rows){let m=new Map(data.history.map(x=>[x.date,x])),before=m.size;rows.forEach(x=>m.set(x.date,x));data.history=[...m.values()].sort((a,b)=>a.date.localeCompare(b.date));store();return m.size-before}
function seed(){if(data.history.length)return;try{let d=window.SPORTKA_INITIAL_DATA;if(!d)throw Error('Chybí initial-data.js');data.history=parseHistory(d.history);if(!data.bets.length)data.bets=parseBets(d.bets);store()}catch(e){info(e.message,true)}}
const draws=()=>new Map(data.history.map(h=>[h.date,h.draws]));const rank=(hits,bonus)=>hits===6?1:hits===5&&bonus?2:hits===5?3:hits===4?4:hits===3?5:0;
function evaluate(silent=false){let map=draws(),n=0;for(let b of data.bets){let d=map.get(b.date),a=valid(b.numbers);if(!d||!a)continue;let matches=d.map(x=>a.filter(k=>x.numbers.includes(k))),r=d.map((x,i)=>rank(matches[i].length,a.includes(x.bonus))),result=r.some(Boolean)?'Výhra ('+r.filter(Boolean).map(x=>x+'. pořadí').join(', ')+')':'Prohra';let h1=matches[0].join(','),h2=matches[1].join(',');if(b.result!==result||b.hits1!==h1||b.hits2!==h2){b.result=result;b.hits1=h1;b.hits2=h2;b.ranks=r;n++}}if(n)(silent?store():persist());return n}
const combinations=(a,k)=>{let out=[],work=[];function go(start){if(work.length===k){out.push(work.join(','));return}for(let i=start;i<=a.length-(k-work.length);i++){work.push(a[i]);go(i+1);work.pop()}}go(0);return out};
function normalize(map,keys){let vals=keys.map(k=>Math.log1p(map.get(k)||0)),lo=Math.min(...vals),hi=Math.max(...vals);return new Map(keys.map((k,i)=>[k,hi===lo?.5:(vals[i]-lo)/(hi-lo)]))}
function stats(){let freq=new Map(),pairs=new Map(),triples=new Map(),learn=new Map(),learnPairs=new Map(),checked=0;const inc=(m,k,v=1)=>m.set(k,(m.get(k)||0)+v);for(let h of data.history)for(let d of h.draws){d.numbers.forEach(n=>inc(freq,n));combinations(d.numbers,2).forEach(k=>inc(pairs,k));combinations(d.numbers,3).forEach(k=>inc(triples,k))}let map=draws();for(let b of data.bets){let ds=map.get(b.date),a=valid(b.numbers);if(!ds||!a)continue;checked++;for(let d of ds){let hit=new Set(a.filter(n=>d.numbers.includes(n)));a.forEach(n=>inc(learn,n,(hit.has(n)?1:0)-6/49));for(let p of combinations(a,2)){let [x,y]=p.split(',').map(Number);inc(learnPairs,p,(hit.has(x)&&hit.has(y)?1:0)-30/(49*48))}}}let nums=Array.from({length:49},(_,i)=>i+1),ps=combinations(nums,2),ts=combinations(nums,3),scale=m=>Math.max(1,...[...m.values()].map(Math.abs));return {freq,single:normalize(freq,nums),pairs:normalize(pairs,ps),triples:normalize(triples,ts),learn,learnPairs,ls:scale(learn),lps:scale(learnPairs),checked}}
function structure(a){let low=a.filter(n=>n<=25).length,even=a.filter(n=>n%2===0).length,span=(a[5]-a[0])/48,buckets=new Set(a.map(n=>Math.floor((n-1)/10))).size/5,spread=(1-Math.abs(low-3)/3)*.4+span*.3+buckets*.3,parity=1-Math.abs(even-3)/3,run=1,longest=1;for(let i=1;i<6;i++){run=a[i]===a[i-1]+1?run+1:1;longest=Math.max(longest,run)}return 6*spread+1.5*parity-Math.max(0,longest-2)*1.8}
function score(a,s){let p=combinations(a,2),t=combinations(a,3);return a.reduce((v,n)=>v+(s.single.get(n)||0)*28+(s.learn.get(n)||0)/s.ls*2.5,0)+p.reduce((v,k)=>v+(s.pairs.get(k)||0)*13+(s.learnPairs.get(k)||0)/s.lps*1.5,0)+t.reduce((v,k)=>v+(s.triples.get(k)||0)*2.5,0)+structure(a)}
function randomLine(s,uniform=false){let available=Array.from({length:49},(_,i)=>i+1),weights=available.map(n=>uniform?1:Math.pow((s.freq.get(n)||0)+1,.25)),out=[];for(let j=0;j<6;j++){let total=weights.reduce((a,b)=>a+b,0),r=Math.random()*total,i=0;for(;i<weights.length-1;i++){r-=weights[i];if(r<=0)break}out.push(available.splice(i,1)[0]);weights.splice(i,1)}return out.sort((a,b)=>a-b)}
function generate(initialRun=false){if(!data.history.length)throw Error('Chybí historie losování.');let s=stats(),excluded=new Set(data.bets.map(b=>key(b.numbers))),seen=new Set(),candidates=[];for(let i=0;i<30000;i++){let a=randomLine(s,i%5===0),k=a.join(',');if(seen.has(k)||excluded.has(k))continue;seen.add(k);candidates.push({a,score:score(a,s)})}candidates.sort((a,b)=>b.score-a.score);candidates=candidates.slice(0,6000);let chosen=[],usage=Array(50).fill(0);for(let j=0;j<6;j++){let best=null,top=-Infinity;for(let pool of [candidates.slice(0,1400),candidates]){for(let c of pool){if(c.a.some(n=>usage[n]>=4)||chosen.some(a=>a.filter(n=>c.a.includes(n)).length>2))continue;let repeated=c.a.reduce((v,n)=>v+usage[n],0),avg=chosen.length?chosen.reduce((v,a)=>v+a.filter(n=>c.a.includes(n)).length,0)/chosen.length:0,bonus=chosen.length?Math.max(0,6-repeated)+(avg<=1?7:avg<=1.5?4:1):0,value=c.score+bonus;if(value>top){top=value;best=c}}if(best)break}if(!best)throw Error('Nelze sestavit šest sloupců bez porušení omezení.');chosen.push(best.a);best.a.forEach(n=>usage[n]++)}if(!initialRun)checkpoint();data.predictions=chosen;if(initialRun)store();else persist();render();info(`Vygenerováno 6 kombinací. Historie: ${data.history.length} losování, učení: ${s.checked} ověřených sázek.`)}
function updatePredictionCount(card,a,i){
 const h=card.querySelector('h3');if(!h)return;
 h.replaceChildren(document.createTextNode(`Kombinace ${i+1} (`));
 const count=document.createElement('span');count.textContent=String(a.length);
 if(a.length!==6)count.className='prediction-count-error';
 h.append(count,document.createTextNode(')'));
}
function firstIncompletePrediction(){return data.predictions.findIndex(a=>!valid(a))}
function render(){let pred=$('predictions');pred.replaceChildren();data.predictions.forEach((a,i)=>{
 let card=document.createElement('div');card.className='ticket';let h=document.createElement('h3');card.append(h);
 let grid=document.createElement('div');grid.className='balls';
 for(let n=1;n<=49;n++){
  let ball=document.createElement('span');ball.className='ball'+(a.includes(n)?' on':'');ball.textContent=n;
  ball.setAttribute('role','button');ball.tabIndex=0;ball.setAttribute('aria-pressed',String(a.includes(n)));
  ball.setAttribute('aria-label',`Kombinace ${i+1}, číslo ${n}`);
  const toggle=()=>{
   const pos=a.indexOf(n);
   if(pos>=0){a.splice(pos,1)}else if(a.length<6){a.push(n);a.sort((x,y)=>x-y)}
   else{info(`Kombinace ${i+1} již obsahuje 6 čísel. Nejprve jedno odznač.`);return}
   ball.classList.toggle('on',a.includes(n));ball.setAttribute('aria-pressed',String(a.includes(n)));
   updatePredictionCount(card,a,i);persist();updateAttention();
  };
  ball.addEventListener('click',toggle);
  ball.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}});
  grid.append(ball)
 }
 card.append(grid);updatePredictionCount(card,a,i);pred.append(card)
});$('save').disabled=data.predictions.length!==6;let tbody=$('bets');tbody.replaceChildren();
let dated=new Map();for(let bet of [...data.bets].sort((a,b)=>b.date.localeCompare(a.date)||(a.order||0)-(b.order||0))){if(!dated.has(bet.date))dated.set(bet.date,[]);dated.get(bet.date).push(bet)}
for(let [day,all] of dated){for(let offset=0;offset<all.length;offset+=8){let group=all.slice(offset,offset+8),groupIndex=Math.floor(offset/8)+1;
for(let [i,bet] of group.entries()){
let tr=document.createElement('tr');tr.className=i===0?'batch-row':'batch-detail';
let dayCell=document.createElement('td');dayCell.textContent=day;tr.append(dayCell);
let combo=document.createElement('td');let chips=document.createElement('div');chips.className='chips';bet.numbers.forEach(n=>{let c=document.createElement('span');c.className='chip';c.textContent=n;chips.append(c)});combo.append(chips);tr.append(combo);
let result=document.createElement('td');result.textContent=bet.result||'Nevyhodnoceno';if(String(bet.result).toLowerCase().includes('výhra')||String(bet.result).toLowerCase()==='vyhra'){result.className='winning';if(Number(bet.amount)>0)result.textContent+=' · '+bet.amount+' Kč'}tr.append(result);
for(let value of [bet.hits1||'–',bet.hits2||'–']){let td=document.createElement('td');td.textContent=value;tr.append(td)}
let action=document.createElement('td');if(i===0){let del=document.createElement('button');del.className='delete-link';del.textContent='× Smazat';del.title='Smazat celou sadu';del.onclick=()=>{if(!confirm(`Smazat celou sadu ${groupIndex} z ${day} (${group.length} sloupců)?`))return;checkpoint();let removed=new Set(group);data.bets=data.bets.filter(x=>!removed.has(x));persist();render()};action.append(del)}tr.append(action);tbody.append(tr);
}

}}
updateAttention();
 if($('stats'))$('stats').textContent=`Historie: ${data.history.length} losování · Sázky: ${data.bets.length} · Výhry: ${data.bets.filter(b=>String(b.result).toLowerCase().includes('výhra')||String(b.result).toLowerCase()==='vyhra').length} · Učení z ${stats().checked} ověřených sázek`}
 function updateAttention(){
  const save=$('save'),evalBtn=$('evaluate'),chosen=$('date').value;
  const predicted=data.predictions.map(a=>key(a)).filter(Boolean);
  const staked=data.bets.filter(b=>b.date===chosen).map(b=>key(b.numbers)).filter(Boolean);
  const alreadySaved=predicted.length===6&&predicted.length===staked.length&&predicted.every(k=>staked.includes(k));
  save.classList.toggle('blinking-button',predicted.length===6&&!alreadySaved);
  // Blikat po celou dobu, kdy existuje alespoň jedna nevyhodnocená sázka,
  // i pokud se teprve čeká na losování a výsledky ještě nejsou v historii.
  const waiting=data.bets.some(b=>!b.result||String(b.result).toLowerCase().includes('nevyhodnoceno'));
  evalBtn.classList.toggle('blinking-button',waiting);
 }
const encode=s=>btoa(Array.from(new TextEncoder().encode(s),c=>String.fromCharCode(c)).join(''));const decode=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,'')),c=>c.charCodeAt(0)));
async function remote(method='GET',payload){if(!config())throw Error('Nejdříve nastav GitHub přístup.');let url=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${REMOTE}`,r=await fetch(url,{method,headers:{Authorization:`Bearer ${cfg.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})}),j=await r.json();if(!r.ok){if(r.status===404&&method==='GET'){const check=await fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},cache:'no-store'}).catch(()=>null);if(check?.ok){const meta=await check.json();const branch=meta.default_branch||'main';const file=await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/${encodeURIComponent(branch)}/${REMOTE}?t=${Date.now()}`,{cache:'no-store'}).catch(()=>null);if(file?.ok)throw Error('Soubor na veřejném GitHubu existuje, ale GitHub API jej s tímto tokenem nevidí (HTTP 404). Zkontroluj oprávnění tokenu k repozitáři Sportka; data nebyla změněna.');throw Error(`GitHub API 404: repozitář existuje, ale ${REMOTE} není dostupný na výchozí větvi ${branch}. Zkontroluj cestu a oprávnění tokenu.`)}throw Error(`GitHub API 404: repozitář ${cfg.owner}/${cfg.repo} nebo přístup k němu nebyl nalezen. Zkontroluj vlastníka, název a token.`)}if(r.status===409||r.status===422)throw Error('GitHub konflikt: nejprve zálohuj a načti společná data.');throw Error(j.message||`GitHub HTTP ${r.status}`)}// GitHub Contents API u souborů nad 1 MB vrací prázdné content (encoding: none).
// Skutečný obsah načteme přes Git Blobs API podle SHA; metadata SHA zůstávají
// pro bezpečnou kontrolu konfliktů při následném ukládání.
if(method==='GET'&&j&&(!j.content||j.encoding==='none')){
 if(!j.sha)throw Error('GitHub nevrátil SHA společného JSON.');
 const blobUrl=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/git/blobs/${encodeURIComponent(j.sha)}`;
 const b=await fetch(blobUrl,{headers:{Authorization:`Bearer ${cfg.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
 const raw=await b.text();let blob;
 try{blob=JSON.parse(raw)}catch{throw Error(`GitHub vrátil neplatnou odpověď pro JSON (HTTP ${b.status}).`)}
 if(!b.ok)throw Error(blob.message||`GitHub blob HTTP ${b.status}`);
 if(blob.encoding!=='base64'||!blob.content)throw Error('GitHub nevrátil obsah společného JSON ani přes Git Blobs API.');
 j.content=blob.content;j.encoding=blob.encoding;
}
return j}
function validate(d){if(!d||!Array.isArray(d.history)||!Array.isArray(d.bets)||!Array.isArray(d.predictions))throw Error('Neplatný JSON společných dat');limitPredictions(d)}
async function pull(force=false){
 if(dirty&&!force)throw Error('Místní změny nejsou synchronizované. Nejprve ulož zálohu JSON.');
 if(saving||polling)throw Error('Probíhá synchronizace. Zkus načtení znovu.');
 const rev=revision,j=await remote();if(!j)return false;
 let d;try{d=JSON.parse(decode(j.content))}catch{throw Error('Společný JSON nelze přečíst. Místní sázky zůstaly zachovány.')}
 validate(d);if(revision!==rev)throw Error('Během načítání vznikly místní změny. Společná data nebyla použita.');
 const history=data.history;data=d;clearUndo();sha=j.sha;dirty=false;conflict=false;localStorage.removeItem(DIRTY);
 mergeHistory(history);evaluate(true);store();render();syncSignal(true);return true
}
async function push(){
 if(saving)throw Error('Právě probíhá automatické ukládání.');
 return saveToGitHub();
}
async function saveToGitHub(){
 if(!config())throw Error('Nejdříve nastav GitHub přístup.');
 const latest=await remote();
 if((latest?.sha||null)!==sha){conflict=true;throw Error('GitHub konflikt: společná verze se změnila. Zálohuj místní data a načti společnou verzi.')}
 const rev=revision,content=encode(JSON.stringify(data,null,2));
 const j=await remote('PUT',{message:'Sportka AI: synchronizace dat',content,...(sha?{sha}:{})});
 sha=j.content.sha;
 if(revision===rev){dirty=false;conflict=false;localStorage.removeItem(DIRTY)}
 else {dirty=true;localStorage.setItem(DIRTY,'1');setTimeout(()=>autosave().catch(e=>info(e.message,true)),1500)}
 if(!dirty)syncSignal(true);
}
async function autosave(){
 if(!config()||saving||!dirty||conflict||!navigator.onLine)return;
 saving=true;
 try{
  if(sha===null){
   const latest=await remote();
   if(latest){let d;try{d=JSON.parse(decode(latest.content))}catch{throw Error('Společný JSON nelze přečíst; automatické ukládání zastaveno.')}
    validate(d);
    if(JSON.stringify(d.bets)!==JSON.stringify(data.bets)||JSON.stringify(d.predictions)!==JSON.stringify(data.predictions)){
     conflict=true;throw Error('Společná data se liší. Nejdříve zálohuj a načti společnou verzi.')
    }
    sha=latest.sha;
   }
  }
  await saveToGitHub();
 }finally{saving=false}
}
async function periodicSync(){
 if(polling||saving||!config()||!navigator.onLine)return;
 polling=true;
 try{
  if(dirty){if(!conflict)await autosave();return}
  const rev=revision,latest=await remote();if(!latest)return;
  if(latest.sha===sha){if(!dirty)syncSignal(true);return;}
  let d;try{d=JSON.parse(decode(latest.content))}catch{throw Error('Společný JSON nelze přečíst. Místní data zůstala zachována.')}
  validate(d);
  if(dirty||revision!==rev||saving)return;
  const history=data.history;data=d;sha=latest.sha;clearUndo();mergeHistory(history);evaluate(true);store();render();
  syncSignal(true);
 }catch(e){syncStatus('Synchronizace: '+e.message,'error')}finally{polling=false}
}
function download(name,s){let blob=new Blob([s],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
const historyCSV=()=>['datum;rok;tyden;den;1. cislo 1. tah;2. cislo 1. tah;3. cislo 1. tah;4. cislo 1. tah;5. cislo 1. tah;6. cislo 1. tah;dodatkove cislo 1. tah;1. cislo 2. tah;2. cislo 2. tah;3. cislo 2. tah;4. cislo 2. tah;5. cislo 2. tah;6. cislo 2. tah;dodatkove cislo 2. tah',...data.history.slice().reverse().map(h=>[h.date.split('-').reverse().join('.'),h.date.slice(0,4),'','',...h.draws[0].numbers,h.draws[0].bonus,...h.draws[1].numbers,h.draws[1].bonus].join(';'))].join('\r\n')+'\r\n';
const betsCSV=()=>['datum;kombinace;castka;metoda;vysledek;tah 1;tah 2',...data.bets.map(b=>[b.date.split('-').reverse().join('.'),b.numbers.join(','),b.amount||0,b.method||'Sportka AI WEB',String(b.result).startsWith('Výhra')?'vyhra':String(b.result).toLowerCase().includes('prohra')?'prohra':'',b.hits1||'',b.hits2||''].join(';'))].join('\r\n')+'\r\n';
const act=(id,fn)=>$(id).onclick=async()=>{try{await fn()}catch(e){info(e.message,true)}};
act('generate',()=>generate());act('save',()=>{let d=$('date').value;if(!d||![0,3,5].includes(new Date(d+'T12:00:00').getDay()))throw Error('Vyber středu, pátek nebo neděli.');if(d<new Date().toLocaleDateString('sv-SE'))throw Error('Nelze uložit sázku na minulé datum.');if(data.predictions.length!==6)throw Error('Nejdříve vygeneruj šest kombinací.');
 const incomplete=firstIncompletePrediction();
 if(incomplete!==-1){
  const missing=6-data.predictions[incomplete].length;
  if(matchMedia('(max-width:700px)').matches){$('predictions').children[incomplete]?.scrollIntoView({behavior:'smooth',block:'center'})}
  throw Error(`Kombinace ${incomplete+1}: chybí ${missing} ${missing===1?'číslo':missing>=2&&missing<=4?'čísla':'čísel'}. Pro uložení musí mít každá kombinace 6 čísel.`)
 }
 let old=new Set(data.bets.filter(b=>b.date!==d).map(b=>key(b.numbers))),batch=new Set(),accepted=[];for(let a of data.predictions){let k=key(a);if(!k||old.has(k)||batch.has(k))continue;batch.add(k);accepted.push(a)}if(!accepted.length)throw Error('Všechny kombinace už byly vsazeny; nic se nezměnilo.');checkpoint();data.bets=data.bets.filter(b=>b.date!==d);accepted.forEach((a,i)=>data.bets.push({date:d,numbers:a,result:'Nevyhodnoceno',hits1:'',hits2:'',method:'Sportka AI WEB',amount:'0',order:i+1}));persist();render();info(`Uloženo ${accepted.length} sázek.`)});
act('evaluate',()=>{checkpoint();let n=evaluate();if(!n){undoStack.pop();updateUndoButtons()}render();info(n?`Vyhodnoceno ${n} sázek.`:'Žádné nové výsledky k vyhodnocení.')});
act('undo',()=>travel(undoStack,redoStack,'Vrácena poslední změna.'));act('redo',()=>travel(redoStack,undoStack,'Změna znovu provedena.'));updateUndoButtons();
act('connect',async()=>{cfg={owner:$('owner').value.trim(),repo:$('repo').value.trim(),token:$('token').value.trim()};if(!config())throw Error('Vyplň GitHub uživatele, repozitář a token.');localStorage.setItem(CFG,JSON.stringify(cfg));sessionStorage.removeItem(CFG);sha=null;conflict=false;if(dirty){info('Přístup nastaven. Místní změny nejsou synchronizované – nejprve exportuj zálohu JSON.');return}let ok=await pull();info(ok?'Společná data načtena.':'Přístup nastaven. Společný JSON zatím neexistuje.')});
act('pull',async()=>{if(!confirm(dirty?'Máš nesynchronizované změny. Doporučujeme nejprve Záloha JSON. Opravdu načíst společnou verzi?':'Načíst společnou databázi z GitHubu?'))return;let ok=await pull(true);if(!ok)throw Error('sportka-data.json neexistuje.');info('Společná data načtena.')});
act('push',async()=>{if(sha===null){let latest=await remote();if(latest)throw Error('Společná data už existují. Nejprve načti společnou verzi.')}await push();info('Společná data uložena na GitHub.')});
act('disconnect',()=>{cfg={};sha=null;localStorage.removeItem(CFG);sessionStorage.removeItem(CFG);$('token').value='';syncStatus('nepřipojeno','error')});
act('exportHistory',()=>download('sportka.csv',historyCSV()));act('exportBets',()=>download('vsazene_kombinace.csv',betsCSV()));act('exportPred',()=>download('sportka_predikce.csv',data.predictions.map(a=>a.join(',')).join('\r\n')+'\r\n'));act('backup',()=>download('sportka-zaloha.json',JSON.stringify(data,null,2)));
$('importHistory').onchange=async e=>{try{let f=e.target.files[0];if(!f)return;let rows=parseHistory(await f.text());if(confirm(`Nahradit historii (${rows.length} losování)?`)){checkpoint();data.history=rows;persist();render()}}catch(err){info(err.message,true)}};
$('importBets').onchange=async e=>{try{let f=e.target.files[0];if(!f)return;let rows=parseBets(await f.text());if(confirm(`Nahradit sázky (${rows.length})?`)){checkpoint();data.bets=rows;persist();render()}}catch(err){info(err.message,true)}};
$('restore').onchange=async e=>{try{let f=e.target.files[0];if(!f)return;let d=JSON.parse(await f.text());validate(d);if(confirm('Přepsat místní data zálohou?')){checkpoint();data=d;persist();render()}}catch(err){info(err.message,true)}};
async function refresh(){if(location.protocol==='file:')return;let r=await fetch('./sportka.csv?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('Historie CSV HTTP '+r.status);let n=mergeHistory(parseHistory(await r.text()));if(n){evaluate(true);render();info(`Načteno ${n} nových losování.`)}}
$('owner').value=cfg.owner||'';$('repo').value=cfg.repo||'';let now=new Date(),d=new Date(now);while(![0,3,5].includes(d.getDay()))d.setDate(d.getDate()+1);$('date').value=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
// Sportka: středa, pátek, neděle. Stejný Flatpickr na PC i mobilu.
if(typeof flatpickr==='function'){
 const sportkaPicker=flatpickr($('date'),{
  locale:'cs',disableMobile:true,dateFormat:'Y-m-d',altInput:true,altFormat:'d. m. Y',
  defaultDate:$('date').value,minDate:'today',onChange:()=>updateAttention(),
  enable:[dt=>[0,3,5].includes(dt.getDay())],
  onDayCreate:(_a,_b,_fp,el)=>{if([0,3,5].includes(el.dateObj.getDay()))el.classList.add('draw-day')},
  onOpen:(_a,_b,fp)=>{if(matchMedia('(max-width:600px)').matches)fp.calendarContainer.classList.add('sportka-mobile-centered')},
  onReady:(_a,_b,fp)=>{let legend=document.createElement('div');legend.className='sportka-legend';legend.textContent='🟢 St / Pá / Ne = losování  ·  Modrá = vybráno';fp.calendarContainer.append(legend)}
 });
}else{
 $('date').type='date';$('date').readOnly=false;
}
seed();evaluate(true);render();syncStatus(config()?(dirty?'místní změny čekají na odeslání':'připojeno – ověřuji synchronizaci'):'nepřipojeno',config()?'info':'error');(async()=>{try{await refresh()}catch(e){info(e.message,true)}if(config()&&!dirty){try{await pull();await refresh()}catch(e){info(e.message,true)}}if(!data.predictions.length&&data.history.length){try{generate(true)}catch(e){info('Automatické generování: '+e.message,true)}}})();
setInterval(()=>{if(config()&&navigator.onLine){if(dirty&&!conflict)autosave().catch(e=>info(e.message,true));else if(!dirty)periodicSync()}},SYNC_MS);
window.addEventListener('online',()=>periodicSync());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)periodicSync()});
if(dirty&&config()&&!conflict)autosave().catch(e=>info(e.message,true));
})();
