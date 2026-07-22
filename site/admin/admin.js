import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.HAPPY_ENDING_CONFIG || {};
const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: { detectSessionInUrl: true, persistSession: true }
});
const $ = selector => document.querySelector(selector);
const loginPanel=$('#login-panel'), resetPanel=$('#reset-panel'), dashboard=$('#dashboard');
const loginMessage=$('#login-message'), resetMessage=$('#reset-message');
let recoveryMode = /type=recovery|access_token=|code=/.test(`${location.search}${location.hash}`);
const SHARED_TOKEN_PATTERN = /^[0-9a-f]{32,128}$/i;

function baseGameUrl(){
  const url = new URL('../', location.href);
  url.hash=''; url.search='';
  return url.toString();
}
function showView(view){
  loginPanel.classList.toggle('hidden',view!=='login');
  resetPanel.classList.toggle('hidden',view!=='reset');
  dashboard.classList.toggle('hidden',view!=='dashboard');
}
function cleanRecoveryUrl(){history.replaceState({},document.title,location.pathname)}
function formatDate(value){return value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—'}
function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
function shortBrowserId(token=''){return token.length>12 ? `${token.slice(0,6)}…${token.slice(-6)}` : token}

async function verifyAdmin(){
  if(recoveryMode){showView('reset');return false}
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){showView('login');return false}
  const {data,error}=await supabase.from('admin_users').select('user_id').eq('user_id',session.user.id).maybeSingle();
  if(error||!data){await supabase.auth.signOut();showView('login');loginMessage.textContent='This account is not an administrator.';return false}
  showView('dashboard');
  renderSharedLink();
  await Promise.all([loadPlayers(),loadSettings()]);
  return true;
}

$('#login-form').addEventListener('submit',async e=>{
  e.preventDefault();loginMessage.textContent='Signing in…';
  const {error}=await supabase.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
  if(error){loginMessage.textContent=error.message;return}
  loginMessage.textContent='';await verifyAdmin();
});

$('#forgot-password').onclick=async()=>{
  const email=$('#email').value.trim();
  if(!email){loginMessage.textContent='Enter your email address first.';$('#email').focus();return}
  loginMessage.textContent='Sending recovery email…';
  const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}/admin/`});
  loginMessage.textContent=error?error.message:'Recovery email sent. Open the newest message in your inbox.';
};

$('#reset-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const password=$('#new-password').value;
  const confirmation=$('#confirm-password').value;
  if(password.length<8){resetMessage.textContent='Use at least 8 characters.';return}
  if(password!==confirmation){resetMessage.textContent='The passwords do not match.';return}
  resetMessage.textContent='Saving…';
  const {error}=await supabase.auth.updateUser({password});
  if(error){resetMessage.textContent=error.message;return}
  resetMessage.textContent='Password changed successfully.';
  recoveryMode=false;cleanRecoveryUrl();
  setTimeout(()=>verifyAdmin(),650);
});

$('#sign-out').onclick=async()=>{await supabase.auth.signOut();showView('login')};

function renderSharedLink(){
  const url=baseGameUrl();
  $('#shared-game-url').value=url;
  $('#open-game').href=url;
  const target=$('#shared-qr');
  target.innerHTML='';
  if(window.QRCode){
    new QRCode(target,{text:url,width:210,height:210,colorDark:'#090b14',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H});
  }
}

$('#copy-shared-link').onclick=async()=>{
  await navigator.clipboard.writeText($('#shared-game-url').value);
  const message=$('#shared-link-message');message.textContent='Shared link copied.';
  setTimeout(()=>message.textContent='',1800);
};

$('#download-qr').onclick=()=>{
  const canvas=$('#shared-qr canvas');
  const image=$('#shared-qr img');
  const href=canvas?.toDataURL('image/png')||image?.src;
  if(!href){alert('QR code is not ready yet.');return}
  const link=document.createElement('a');
  link.href=href;link.download='happy-ending-shared-qr.png';link.click();
};

const QUESTION_LABELS={
  q1:'Belong here?',q3:"What'll you choose?",q4:'Good girl or bad girl?',q5:'A little dangerous?',
  height:'Height',weight:'Weight',q8:'Dance floor',q9:'Attention',q10:'Orientation',q12:'Day together',
  q13:'First move',q14:'Risk level',q15:'Final choice'
};
function formatDuration(seconds){
  if(seconds==null||!Number.isFinite(Number(seconds)))return '—';
  const value=Math.max(0,Math.round(Number(seconds)));
  const minutes=Math.floor(value/60),rest=value%60;
  return minutes?`${minutes}m ${rest}s`:`${rest}s`;
}
function percentage(part,total){return total?`${Math.round(part/total*100)}%`:'0%'}
function startOfDay(date){const d=new Date(date);d.setHours(0,0,0,0);return d}
function countSince(players,days){
  const cutoff=startOfDay(new Date());cutoff.setDate(cutoff.getDate()-(days-1));
  return players.filter(p=>new Date(p.created_at)>=cutoff).length;
}
function flattenAttempts(players){
  return players.flatMap(player=>{
    const attempts=Array.isArray(player.attempts)?player.attempts:(player.attempts?[player.attempts]:[]);
    return attempts.map(attempt=>({...attempt,playerCreatedAt:player.created_at,playerStartedAt:player.started_at}));
  });
}
function renderAnalytics(players){
  const attempts=flattenAttempts(players);
  const completed=attempts.filter(a=>a.result==='winner'||a.result==='loser');
  const winners=completed.filter(a=>a.result==='winner');
  const losers=completed.filter(a=>a.result==='loser');
  const durations=completed.map(a=>Number(a.duration_seconds)).filter(Number.isFinite);
  const average=durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null;
  const started=players.filter(p=>p.started_at||['playing','winner','loser'].includes(p.status)).length;
  $('#analytics-sample').textContent=completed.length?`${completed.length} completed game${completed.length===1?'':'s'}`:'No completed games yet';
  $('#result-metrics').innerHTML=[
    ['Unique visitors',players.length,''],['Started',started,''],['Win rate',percentage(winners.length,completed.length),'positive'],
    ['Average time',formatDuration(average),''],['Winners',winners.length,'positive'],['Game Over',losers.length,'negative'],
    ['Completion rate',percentage(completed.length,started),''],['In progress',players.filter(p=>p.status==='playing').length,'']
  ].map(([label,value,klass])=>`<div class="metric"><span>${label}</span><strong class="${klass}">${value}</strong></div>`).join('');
  $('#activity-metrics').innerHTML=[['Today',countSince(players,1)],['7 days',countSince(players,7)],['30 days',countSince(players,30)]].map(([l,n])=>`<div class="metric"><span>${l}</span><strong>${n}</strong></div>`).join('');

  const failures={};
  losers.forEach(a=>{const label=(a.losing_question||'Unknown question').trim();failures[label]=(failures[label]||0)+1});
  const failureRows=Object.entries(failures).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxFailure=failureRows[0]?.[1]||1;
  $('#failure-chart').innerHTML=failureRows.length?failureRows.map(([label,count])=>`<div class="bar-row"><div class="bar-label"><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><strong>${count} · ${percentage(count,losers.length)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${count/maxFailure*100}%"></div></div></div>`).join(''):'<p class="muted">No failed games yet.</p>';

  const answerTotals={};
  attempts.forEach(a=>{
    const answers=a.answers&&typeof a.answers==='object'?a.answers:{};
    Object.entries(answers).forEach(([key,value])=>{
      if(value==null||value==='')return;
      answerTotals[key]??={total:0,choices:{}};
      answerTotals[key].total++;
      const choice=String(value);answerTotals[key].choices[choice]=(answerTotals[key].choices[choice]||0)+1;
    });
  });
  const answerGroups=Object.entries(answerTotals).filter(([,v])=>Object.keys(v.choices).length>1).sort((a,b)=>b[1].total-a[1].total).slice(0,5);
  $('#answer-insights').innerHTML=answerGroups.length?answerGroups.map(([key,data])=>{
    const choices=Object.entries(data.choices).sort((a,b)=>b[1]-a[1]).slice(0,4);
    return `<div class="answer-card"><div class="answer-question">${escapeHtml(QUESTION_LABELS[key]||key)}</div>${choices.map(([choice,count])=>`<div class="answer-choice"><span class="answer-choice-name" title="${escapeHtml(choice)}">${escapeHtml(choice)}</span><span class="answer-choice-value">${count} · ${percentage(count,data.total)}</span><div class="answer-mini-track"><div class="answer-mini-fill" style="width:${count/data.total*100}%"></div></div></div>`).join('')}</div>`;
  }).join(''):'<p class="muted">No answer data yet.</p>';
}

async function loadPlayers(){
  const {data,error}=await supabase.from('players').select('id,token,status,player_name,started_at,completed_at,created_at,attempts(result,winning_path,losing_question,duration_seconds,answers,created_at)').order('created_at',{ascending:false});
  if(error){console.error(error);return}
  // Ignore legacy pre-generated QR tokens. Shared-QR browser identities are long hexadecimal values.
  const players=(data||[]).filter(p=>SHARED_TOKEN_PATTERN.test(p.token||''));
  renderAnalytics(players);
  const counts={all:players.length,playing:0,winner:0,loser:0};
  players.forEach(p=>{if(counts[p.status]!==undefined)counts[p.status]++});
  $('#stats').innerHTML=[['Total players',counts.all],['In progress',counts.playing],['Winners',counts.winner],['Losers',counts.loser]].map(([l,n])=>`<div class="stat"><span class="muted">${l}</span><strong>${n}</strong></div>`).join('');
  $('#players').innerHTML=players.map(p=>{
    const attempt=Array.isArray(p.attempts)?p.attempts[0]:p.attempts;
    const detail=attempt?.winning_path||attempt?.losing_question||'—';
    return `<tr><td><span class="badge ${p.status}">${escapeHtml(p.status)}</span></td><td>${escapeHtml(p.player_name||'—')}</td><td>${formatDate(p.started_at||p.created_at)}</td><td>${formatDate(p.completed_at)}</td><td>${escapeHtml(detail)}${attempt?.duration_seconds!=null?`<div class="tiny">${attempt.duration_seconds}s</div>`:''}</td><td><span title="${escapeHtml(p.token)}">${escapeHtml(shortBrowserId(p.token))}</span></td><td><button class="secondary reset" data-id="${p.id}" data-name="${escapeHtml(p.player_name||shortBrowserId(p.token)||'this player')}">Reset player</button></td></tr>`;
  }).join('')||'<tr><td colspan="7">No shared-link players yet.</td></tr>';
  document.querySelectorAll('.reset').forEach(b=>b.onclick=async()=>{
    const playerName=b.dataset.name||'this player';
    if(!confirm(`Reset ${playerName}? They will be able to play again on the same browser.`))return;
    b.disabled=true;
    const {error}=await supabase.rpc('reset_player',{p_player_id:b.dataset.id});
    if(error){
      alert(error.message);
      b.disabled=false;
      return;
    }
    await loadPlayers();
  });
}

$('#refresh').onclick=async()=>{const button=$('#refresh');button.disabled=true;await loadPlayers();button.disabled=false};

$('#reset-all-players').onclick=async()=>{
  const typed=prompt('This will reset every shared-QR player and allow everyone to play again. Type RESET ALL to continue.');
  if(typed!=='RESET ALL')return;
  const button=$('#reset-all-players');
  const message=$('#reset-all-message');
  button.disabled=true;
  message.textContent='Resetting all players…';
  const {data,error}=await supabase.rpc('reset_all_shared_players');
  if(error){
    message.classList.remove('success');
    message.textContent=error.message;
    button.disabled=false;
    return;
  }
  message.classList.add('success');
  message.textContent=`Reset complete. ${Number(data||0)} player(s) can play again.`;
  button.disabled=false;
  await loadPlayers();
};

async function loadSettings(){
  const {data,error}=await supabase.from('game_settings').select('*').eq('id',1).single();
  if(error){console.error(error);return}
  $('#winner-url').value=data.winner_url||'';
  $('#winner-link-text').value=data.winner_link_text||"Can't find me? ↗";
  $('#game-enabled').checked=data.game_enabled;
}
$('#save-settings').onclick=async()=>{
  const message=$('#settings-message');message.textContent='Saving…';
  const {error}=await supabase.from('game_settings').update({winner_url:$('#winner-url').value.trim()||null,winner_link_text:$('#winner-link-text').value.trim()||"Can't find me? ↗",game_enabled:$('#game-enabled').checked}).eq('id',1);
  message.classList.toggle('success',!error);
  message.textContent=error?error.message:'Saved.';
};

supabase.auth.onAuthStateChange(event=>{
  if(event==='PASSWORD_RECOVERY'){recoveryMode=true;showView('reset')}
  else if(event==='SIGNED_OUT'){recoveryMode=false;showView('login')}
  else if(!recoveryMode)setTimeout(()=>verifyAdmin(),0);
});

if(recoveryMode)showView('reset');else verifyAdmin();
