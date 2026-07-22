// Password-recovery links created from the Supabase dashboard may land on the site root.
// Forward them to the admin page before the game reads local play state.
(function redirectPasswordRecoveryToAdmin(){
  const combined = `${location.search}${location.hash}`;
  if (/type=recovery|access_token=|code=/.test(combined) && !location.pathname.startsWith('/admin')) {
    location.replace(`/admin/${location.search}${location.hash}`);
  }
})();

const screen = document.querySelector('#screen');
const app = document.querySelector('#app');
const cfg = window.HAPPY_ENDING_CONFIG || {};
const soundToggle = document.querySelector('#sound-toggle');
const state = { name:'', heightBand:'', answers:{}, token:'', startedAt:null, winnerUrl:'', winnerLinkText:"Can't find me? ↗", currentQuestion:'' };
const wait = ms => new Promise(r => setTimeout(r, ms));
const API_READY = cfg.supabaseUrl && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes('YOUR-PROJECT') && !cfg.supabaseAnonKey.includes('YOUR-');
let soundOn = false, audioCtx = null, locked = false;

function rpcHeaders(){
  return {
    apikey: cfg.supabaseAnonKey,
    Authorization: `Bearer ${cfg.supabaseAnonKey}`,
    'Content-Type': 'application/json'
  };
}
async function rpc(name, body){
  if(!API_READY) throw new Error('Supabase is not configured.');
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
    method:'POST', headers:rpcHeaders(), body:JSON.stringify(body || {})
  });
  if(!response.ok){
    const detail = await response.text();
    throw new Error(`${name}: ${response.status} ${detail}`);
  }
  return response.json();
}
function randomDeviceToken(){
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
}
function getToken(){
  const key = 'happy-ending-device-token';
  let token = localStorage.getItem(key);
  if(!token || !/^[0-9a-f]{32,128}$/i.test(token)){
    token = randomDeviceToken();
    localStorage.setItem(key, token);
  }
  return token.toLowerCase();
}

function alreadyLost(){
  document.body.classList.remove('finale');
  document.querySelectorAll('.corner-link,.win-glow').forEach(x=>x.remove());
  setScreen(`<div class="icon">✦</div><h1 class="title">You've already played.</h1><p class="subtitle">Some chances only come once.</p>`,'center');
}
function invalidLink(message='This invitation is not valid.'){
  setScreen(`<div class="icon">✦</div><h1 class="title">Not this time.</h1><p class="subtitle">${message}</p>`,'center');
}
function returningWinner(){
  document.querySelectorAll('.win-glow').forEach(x=>x.remove());
  const glow=document.createElement('div');glow.className='win-glow';document.body.appendChild(glow);
  winnerFinal(true);
}
async function initializeGame(){
  state.token = getToken();
  if(!state.token) return invalidLink('This browser could not create a game identity.');
  if(cfg.demoMode && !API_READY){
    const local = localStorage.getItem(`happy-ending:${state.token}`);
    if(local === 'winner') return returningWinner();
    if(local === 'loser' || local === 'playing') return alreadyLost();
    return intro();
  }
  try{
    const rows = await rpc('get_or_create_game_state',{p_token:state.token});
    const data = Array.isArray(rows) ? rows[0] : rows;
    if(!data?.valid) return invalidLink();
    if(!data.game_enabled) return invalidLink('The game is currently unavailable.');
    state.name = data.player_name || '';
    state.winnerUrl = data.winner_url || cfg.instagramUrl || '#';
    state.winnerLinkText = data.winner_link_text || "Can't find me? ↗";
    if(data.status === 'winner') return returningWinner();
    if(data.status === 'loser' || data.status === 'playing') return alreadyLost();
    intro();
  }catch(error){
    console.error(error);
    invalidLink('The game could not connect. Please try again later.');
  }
}
async function consumePlay(){
  state.startedAt = Date.now();
  if(cfg.demoMode && !API_READY){
    localStorage.setItem(`happy-ending:${state.token}`,'playing');
    return 'playing';
  }
  return rpc('start_game',{p_token:state.token});
}
function deviceType(){
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
}
async function completeGame(result, path=null, losingQuestion=null){
  if(cfg.demoMode && !API_READY){
    localStorage.setItem(`happy-ending:${state.token}`,result);
    return result;
  }
  const duration = state.startedAt ? Math.round((Date.now()-state.startedAt)/1000) : null;
  try{
    return await rpc('finish_game',{
      p_token:state.token,
      p_result:result,
      p_player_name:state.name || null,
      p_answers:state.answers,
      p_winning_path:path,
      p_losing_question:losingQuestion,
      p_duration_seconds:duration,
      p_device_type:deviceType(),
      p_browser_info:navigator.userAgent
    });
  }catch(error){
    console.error('Result could not be saved',error);
    return null;
  }
}

soundToggle.addEventListener('click', () => {
  soundOn = !soundOn;
  soundToggle.textContent = soundOn ? 'Sound on' : 'Sound off';
  soundToggle.setAttribute('aria-pressed', String(soundOn));
  if (soundOn) tone(520,.05,.025);
});
function tone(freq=430,duration=.055,volume=.018){
  if(!soundOn) return;
  audioCtx ??= new (window.AudioContext||window.webkitAudioContext)();
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type='sine';o.frequency.value=freq;
  g.gain.setValueAtTime(volume,audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+duration);
  o.connect(g).connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+duration);
}
function setScreen(html,align='left'){
  locked=false; app.scrollTo({top:0,behavior:'instant'});
  screen.className=`screen align-${align}`;
  screen.style.animation='none'; screen.innerHTML=html;
  void screen.offsetWidth; screen.style.animation='screenIn .58s var(--ease) forwards';
}
async function transition(next,force=false){
  if(locked && !force) return; locked=true;
  screen.style.animation='screenOut .3s var(--ease) forwards';
  await wait(285); next();
}
async function scene(lines,next,{icon='✦',pause=1100,align='center'}={}){
  setScreen(`<div class="icon">${icon}</div><h1 class="reaction" id="scene-text"></h1>`,align);
  const el=document.querySelector('#scene-text');
  for(let i=0;i<lines.length;i++){
    el.animate([{opacity:0,filter:'blur(8px)',transform:'translateY(8px)'},{opacity:1,filter:'blur(0)',transform:'none'}],{duration:420,easing:'cubic-bezier(.22,.75,.22,1)',fill:'both'});
    el.textContent=lines[i];
    const reading=Math.min(1900,Math.max(800,420+lines[i].length*34));
    await wait(Array.isArray(pause)?(pause[i]??reading):Math.max(pause,reading));
    if(i<lines.length-1){
      await el.animate([{opacity:1},{opacity:0,filter:'blur(5px)',transform:'translateY(-6px)'}],{duration:280,easing:'ease',fill:'forwards'}).finished;
      el.style.opacity='0';
    }
  }
  await wait(220); transition(next);
}
function choices(question,options,{subtitle='',eyebrow=''}={}){
  state.currentQuestion=question;
  setScreen(`${eyebrow?`<div class="eyebrow">${eyebrow}</div>`:''}<h2 class="question">${question}</h2>${subtitle?`<p class="subtitle">${subtitle}</p>`:''}<div class="choices" id="choices"></div>`);
  const wrap=document.querySelector('#choices');
  options.forEach((o,i)=>{
    const b=document.createElement('button'); b.type='button'; b.className='choice';
    b.textContent=`${String.fromCharCode(65+i)}) ${o.label}`;
    b.addEventListener('click',async()=>{
      if(locked)return; locked=true; tone(620,.06,.018);
      [...wrap.children].forEach(x=>x.disabled=true); b.classList.add('selected');
      state.answers[o.key||question]=o.label; await wait(270);
      if(o.gameOver)return gameOver(question); if(o.win)return victory();
      if(o.reaction)return reaction(o.reaction,o.next,o.icon); transition(o.next,true);
    }); wrap.appendChild(b);
  });
}
async function reaction(text,next,icon='✦'){
  locked=false;
  await transition(()=>setScreen(`<div class="icon">${icon}</div><p class="reaction">${text}</p>`,'center'));
  await wait(Math.min(1500,Math.max(850,420+text.length*34)));
  transition(next);
}
function intro(){scene(['WAIT.',"This isn't for everyone.",'You might get offended.'],startScreen,{icon:'✦',pause:[1150,1350,1450]})}
function startScreen(){setScreen(`<div class="icon">✦</div><h1 class="title">Dare to try?</h1><button class="primary" id="start">START</button><div class="footer-note">One chance. One wrong answer → Game Over.</div>`,'center');document.querySelector('#start').onclick=async()=>{if(locked)return;locked=true;const result=await consumePlay();if(result==='playing')transition(q1,true);else if(result==='winner')return returningWinner();else alreadyLost()}}
function q1(){choices('Are you sure you belong here?',[{key:'q1',label:'Yes',reaction:"Let's see.",next:nameScreen},{key:'q1',label:'I hope so',reaction:"Let's see.",next:nameScreen},{key:'q1',label:"I'm not sure",reaction:"Let's see.",next:nameScreen}])}
function nameScreen(){
  setScreen(`<h2 class="question">How should I call you?</h2><input id="name" class="field" maxlength="14" autocomplete="off" placeholder="Your name"><button id="continue" class="primary">CONTINUE</button>`);
  const input=document.querySelector('#name'),btn=document.querySelector('#continue');
  const go=()=>{const v=input.value.trim();if(!v){input.focus();input.animate([{transform:'translateX(0)'},{transform:'translateX(-6px)'},{transform:'translateX(6px)'},{transform:'translateX(0)'}],{duration:240});return}state.name=v.slice(0,14);scene([`Nice to meet you, ${state.name}.`],q3,{icon:'✨',pause:1050})};
  btn.onclick=go;input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go()}});input.focus();
}
function q3(){choices("What'll you choose?",[{key:'q3',label:'Go home',gameOver:true},{key:'q3',label:'Go to sleep',gameOver:true},{key:'q3',label:'Keep thinking about missed chances',gameOver:true},{key:'q3',label:'Make the best memories',reaction:'Good start.',icon:'🔥',next:q4},{key:'q3',label:'Do whatever the fuck you want',reaction:'Good start.',icon:'🔥',next:q4}])}
function q4(){choices('When was the last time you did something spontaneous?',[{key:'q4',label:'This week',reaction:'Still alive.',icon:'✨',next:q5},{key:'q4',label:'This month',reaction:'Still alive.',icon:'✨',next:q5},{key:'q4',label:"I can't remember, but I'd like to change it",reaction:'Still alive.',icon:'✨',next:q5},{key:'q4',label:"I don't like it",gameOver:true}])}
function q5(){choices('How many years have you survived so far?',[{key:'q5',label:'Under 15',gameOver:true},{key:'q5',label:'15–17',reaction:'Interesting...',icon:'🪐',next:q6},{key:'q5',label:'18–24',reaction:'Interesting...',icon:'🪐',next:q6},{key:'q5',label:'25–34',reaction:'Interesting...',icon:'🪐',next:q6},{key:'q5',label:'35+',reaction:'Interesting...',icon:'🪐',next:q6}],{subtitle:'Yeah... I mean your age.'})}
function q6(){choices('How tall are you?',[{key:'height',label:'Over 185 cm',next:()=>setHeight('over185')},{key:'height',label:'170–184 cm',next:()=>setHeight('170-184')},{key:'height',label:'155–169 cm',next:()=>setHeight('155-169')},{key:'height',label:'Under 154 cm',next:()=>setHeight('under154')}])}
function setHeight(band){state.heightBand=band;reaction('Not bad.',q7,'↕️')}
function q7(){
  const limits={over185:70,'170-184':60,'155-169':55,under154:50}; const n=limits[state.heightBand];
  choices('How much did chicken nuggets affect you?',[{key:'weight',label:`Over ${n} kg`,gameOver:true},{key:'weight',label:`Under ${n} kg`,reaction:'Looking good.',icon:'✨',next:q8}],{subtitle:"Your weight... we won't tell anyone."});
}
function q8(){choices('Are you...',[{key:'q8',label:'Female',reaction:'Perfect.',icon:'💫',next:q9},{key:'q8',label:'Male',gameOver:true},{key:'q8',label:'Other',gameOver:true}],{eyebrow:'Something easy'})}
function q9(){choices('Would you describe yourself as...',[{key:'q9',label:'Good girl',reaction:"We'll see.",icon:'😈',next:q10},{key:'q9',label:'Bad girl',reaction:'I had a feeling.',icon:'😏',next:q10}])}
function q10(){choices('About who are you spinning around?',[{key:'q10',label:'Heterosexual',reaction:'Good to know.',next:q12},{key:'q10',label:'Bisexual',reaction:'Good to know.',next:q12},{key:'q10',label:'Homosexual',gameOver:true},{key:'q10',label:'Other',gameOver:true},{key:'q10',label:"Let's fuuuck.",next:secretVictory}],{subtitle:'Your orientation.'})}
function q12(){choices('If someone attractive asked you to spend a day together...',[{key:'q12',label:'Yeah!',reaction:'I like confidence.',icon:'✨',next:q13},{key:'q12',label:"I'd think about it",reaction:'Playing it safe?',icon:'◌',next:q14},{key:'q12',label:'No chance',gameOver:true}])}
function q13(){choices('What are you looking for?',[{key:'q13',label:'Fun',reaction:"I was hoping you'd say that.",icon:'🔥',next:q15},{key:'q13',label:'Sex',reaction:"I knew you'd say that.",icon:'😏',next:victory},{key:'q13',label:'Drinking',gameOver:true},{key:'q13',label:'Money',gameOver:true}])}
function q15(){choices('Sooo...',[{key:'q15',label:"Let's have some fun together",reaction:"I knew you'd say that.",icon:'🔥',next:victory},{key:'q15',label:"Nah, I'm a scaredy-cat",gameOver:true}])}
function q14(){choices('Sooo...',[{key:'q14',label:"Let's let our eyes decide",reaction:"They don't lie.",icon:'👁️',next:victory},{key:'q14',label:"Let's regret not trying",gameOver:true}])}
async function gameOver(losingQuestion=state.currentQuestion){
  await completeGame('loser',null,losingQuestion);
  navigator.vibrate?.([80,35,120]);tone(90,.24,.055);
  const f=document.createElement('div');f.className='flash';document.body.appendChild(f);setTimeout(()=>f.remove(),420);
  await wait(180); setScreen(`<div class="icon">☠️</div><h1 class="title">GAME OVER</h1><p class="subtitle">Not today...</p><p class="subtitle">Your Happy Ending is waiting somewhere else.</p>`,'center');
}

async function secretVictory(){
  await completeGame('winner','lets_fuuuck',null);
  document.querySelectorAll('.win-glow').forEach(x=>x.remove());
  const glow=document.createElement('div');glow.className='win-glow';document.body.appendChild(glow);
  scene(['Well...','I like your honesty.','You skipped the rules.','Your Happy Ending is waiting for you...'],winnerFinal,{icon:'✦',pause:[1800,2200,2500,3000]});
}

async function victory(){
  const path = state.answers.q13 === 'Sex' ? 'sex' : (state.answers.q15 ? 'fun' : (state.answers.q14 ? 'eyes' : 'normal'));
  await completeGame('winner',path,null);
  document.querySelectorAll('.win-glow').forEach(x=>x.remove());const glow=document.createElement('div');glow.className='win-glow';document.body.appendChild(glow);
  scene(['You really made it through...','Your Happy Ending is waiting for you...','Now the real game starts.'],winnerFinal,{icon:'✦',pause:[2500,3000,2500]});
}
async function winnerFinal(returning=false){
  document.querySelectorAll('.corner-link').forEach(x=>x.remove());
  setScreen(`${returning?'<p class="eyebrow">Welcome back.</p>':''}<div class="icon">✦</div><h1 class="title">Come for me.</h1>`,'center');
  document.body.classList.add('finale');
  await wait(returning ? 900 : 6500);
  if(!returning) navigator.vibrate?.(70);
  const a=document.createElement('a');
  a.className='corner-link';
  a.textContent=state.winnerLinkText||"Can't find me? ↗";
  a.href=state.winnerUrl||cfg.instagramUrl||'#';
  a.target='_blank';
  a.rel='noopener';
  document.body.appendChild(a);
}
(()=>{
  const c=document.querySelector('#space'),x=c.getContext('2d');let w,h,dpr,stars=[],shoot=null;
  const resize=()=>{dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;c.width=w*dpr;c.height=h*dpr;c.style.width=w+'px';c.style.height=h+'px';x.setTransform(dpr,0,0,dpr,0,0);stars=Array.from({length:Math.min(125,Math.floor(w*h/9000))},()=>({x:Math.random()*w,y:Math.random()*h,r:Math.random()*1.3+.25,a:Math.random()*.65+.18,p:Math.random()*6.28,v:Math.random()*.045+.012}))};
  const spawn=t=>{if(!shoot&&Math.random()<.0018)shoot={x:Math.random()*w*.7,y:Math.random()*h*.35,len:80+Math.random()*100,life:0}};
  const draw=t=>{x.clearRect(0,0,w,h);for(const s of stars){s.y-=s.v;if(s.y<0)s.y=h;const p=.62+.38*Math.sin(t*.001+s.p);x.beginPath();x.arc(s.x,s.y,s.r*p,0,Math.PI*2);x.fillStyle=`rgba(225,230,255,${s.a*p})`;x.fill()}spawn(t);if(shoot){shoot.life+=.035;const a=Math.max(0,1-shoot.life);x.strokeStyle=`rgba(235,238,255,${a*.7})`;x.lineWidth=1;x.beginPath();x.moveTo(shoot.x,shoot.y);x.lineTo(shoot.x+shoot.len,shoot.y+shoot.len*.42);x.stroke();shoot.x+=5;shoot.y+=2.1;if(shoot.life>=1)shoot=null}requestAnimationFrame(draw)};addEventListener('resize',resize);resize();requestAnimationFrame(draw)
})();
initializeGame();
