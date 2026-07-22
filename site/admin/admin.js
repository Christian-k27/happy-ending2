import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.HAPPY_ENDING_CONFIG || {};
const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: { detectSessionInUrl: true, persistSession: true }
});
const $ = selector => document.querySelector(selector);
const loginPanel=$('#login-panel'), resetPanel=$('#reset-panel'), dashboard=$('#dashboard');
const loginMessage=$('#login-message'), resetMessage=$('#reset-message');
let recoveryMode = /type=recovery|access_token=|code=/.test(`${location.search}${location.hash}`);

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
function cleanRecoveryUrl(){
  history.replaceState({},document.title,location.pathname);
}
function formatDate(value){return value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—'}
function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}

async function verifyAdmin(){
  if(recoveryMode){showView('reset');return false}
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){showView('login');return false}
  const {data,error}=await supabase.from('admin_users').select('user_id').eq('user_id',session.user.id).maybeSingle();
  if(error||!data){await supabase.auth.signOut();showView('login');loginMessage.textContent='This account is not an administrator.';return false}
  showView('dashboard');await Promise.all([loadPlayers(),loadSettings()]);return true;
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
  const redirectTo=`${location.origin}/admin/`;
  const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo});
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

async function loadPlayers(){
  const {data:players,error}=await supabase.from('players').select('id,token,status,player_name,started_at,completed_at,created_at,attempts(result,winning_path,losing_question,duration_seconds)').order('created_at',{ascending:false});
  if(error){console.error(error);return}
  const counts={all:players.length,not_played:0,playing:0,winner:0,loser:0};players.forEach(p=>counts[p.status]++);
  $('#stats').innerHTML=[['Total',counts.all],['Not played',counts.not_played],['Winners',counts.winner],['Losers',counts.loser]].map(([l,n])=>`<div class="stat"><span class="muted">${l}</span><strong>${n}</strong></div>`).join('');
  $('#players').innerHTML=players.map(p=>{
    const attempt=Array.isArray(p.attempts)?p.attempts[0]:p.attempts;
    const detail=attempt?.winning_path||attempt?.losing_question||'—';
    const link=`${baseGameUrl()}?token=${encodeURIComponent(p.token)}`;
    return `<tr><td><span class="badge ${p.status}">${p.status}</span></td><td>${escapeHtml(p.player_name||'—')}</td><td>${formatDate(p.started_at)}</td><td>${formatDate(p.completed_at)}</td><td>${escapeHtml(detail)}${attempt?.duration_seconds!=null?`<div class="tiny">${attempt.duration_seconds}s</div>`:''}</td><td><button class="secondary copy-one" data-link="${escapeHtml(link)}">Copy</button><div class="tiny">${escapeHtml(p.token)}</div></td><td><button class="secondary reset" data-id="${p.id}">Reset</button></td></tr>`;
  }).join('')||'<tr><td colspan="7">No players yet.</td></tr>';
  document.querySelectorAll('.reset').forEach(b=>b.onclick=async()=>{if(!confirm('Reset this player and delete the recorded attempt?'))return;b.disabled=true;const {error}=await supabase.rpc('reset_player',{p_player_id:b.dataset.id});if(error)alert(error.message);await loadPlayers()});
  document.querySelectorAll('.copy-one').forEach(b=>b.onclick=()=>navigator.clipboard.writeText(b.dataset.link));
}

$('#generate').onclick=async()=>{
  const count=Math.max(1,Math.min(500,Number($('#token-count').value)||1));
  const {data,error}=await supabase.rpc('generate_player_tokens',{p_count:count});
  if(error){alert(error.message);return}
  const links=data.map(row=>`${baseGameUrl()}?token=${row.token}`);
  $('#generated-links').value=links.join('\n');await loadPlayers();
};
$('#copy-links').onclick=()=>navigator.clipboard.writeText($('#generated-links').value);
$('#refresh').onclick=loadPlayers;

async function loadSettings(){
  const {data,error}=await supabase.from('game_settings').select('*').eq('id',1).single();
  if(error){console.error(error);return}
  $('#winner-url').value=data.winner_url||'';$('#winner-link-text').value=data.winner_link_text||"Can't find me? ↗";$('#game-enabled').checked=data.game_enabled;
}
$('#save-settings').onclick=async()=>{
  const message=$('#settings-message');message.textContent='Saving…';
  const {error}=await supabase.from('game_settings').update({winner_url:$('#winner-url').value.trim()||null,winner_link_text:$('#winner-link-text').value.trim()||"Can't find me? ↗",game_enabled:$('#game-enabled').checked}).eq('id',1);
  message.textContent=error?error.message:'Saved.';
};

supabase.auth.onAuthStateChange((event)=>{
  if(event==='PASSWORD_RECOVERY'){
    recoveryMode=true;showView('reset');
  }else if(event==='SIGNED_OUT'){
    recoveryMode=false;showView('login');
  }else if(!recoveryMode){
    setTimeout(()=>verifyAdmin(),0);
  }
});

if(recoveryMode) showView('reset');
else verifyAdmin();
