/* ============================================
   NEURO-LEVELING v2 — Full Game Logic
   ============================================ */

// ========================
// AUTH & PERSISTENCE
// ========================

let currentUser = null;
let _saveTimeout = null;
let _googleLoginPending = false;
const STORAGE_KEY = 'neuro_leveling_v2';
let currentScreen = 'status';
let lastGuideContextScreen = 'status';
let startHerePreviewDay = null;
let _systemPopupInterval = null;
let _lastSystemPopupAt = 0;
let _systemAudioContext = null;
let _systemAudioUnlocked = false;
let _gearCooldownInterval = null;
let pendingQuestBoardFocus = null;
const SYSTEM_POPUPS_ENABLED = false;
const _domReadyPromise = document.readyState === 'loading'
  ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  : Promise.resolve();

function $(id) { return document.getElementById(id); }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function syncAppChromeMetrics() {
  const root = document.documentElement;
  const userBar = $('userBar');
  const navBar = document.querySelector('.nav-bar');
  root.style.setProperty('--chrome-top', `${userBar ? userBar.offsetHeight : 0}px`);
  root.style.setProperty('--chrome-bottom', `${navBar ? navBar.offsetHeight : 64}px`);
}

function ensureAppVisibility() {
  const login = $('loginScreen');
  const onb = $('onboarding');
  const main = $('mainApp');
  if (!login || !onb || !main) return;

  const allHidden = login.classList.contains('hidden') && onb.classList.contains('hidden') && main.classList.contains('hidden');
  if (!allHidden) return;

  if (currentUser) {
    if (state.onboardingDone) {
      onb.classList.add('hidden');
      main.classList.remove('hidden');
    } else {
      onb.classList.remove('hidden');
      main.classList.add('hidden');
    }
  } else {
    login.classList.remove('hidden');
  }
}

function showAuthError(msg) {
  const el = $('authError');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function getSupabaseErrorMessage(msg) {
  if (!msg) return 'Errore di autenticazione. Riprova.';
  const m = msg.toLowerCase();
  if (m.includes('already registered')) return 'Questa email è già registrata. Prova ad accedere.';
  if (m.includes('invalid login')) return 'Email o password non corretti.';
  if (m.includes('email not confirmed')) return 'Conferma la tua email prima di accedere.';
  if (m.includes('password')) return 'La password deve avere almeno 6 caratteri.';
  if (m.includes('rate limit')) return 'Troppi tentativi. Riprova tra qualche minuto.';
  if (m.includes('invalid email')) return 'Email non valida.';
  return msg;
}

function getOAuthRedirectUrl() {
  const { protocol, origin, pathname } = window.location;
  if (protocol !== 'http:' && protocol !== 'https:') return null;

  const cleanPath = pathname.endsWith('/index.html')
    ? pathname.slice(0, -'/index.html'.length) || '/'
    : pathname;

  return origin + cleanPath;
}

function clearOAuthUrlArtifacts() {
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
}

function buildAvatarSvgDataUri(emoji, color) {
  const fill = color || '#00D4FF';
  const glyph = emoji || '🛡️';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <defs>
        <linearGradient id="avatarGlow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${fill}" />
          <stop offset="100%" stop-color="#0a1020" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="24" fill="url(#avatarGlow)" />
      <circle cx="48" cy="48" r="30" fill="rgba(255,255,255,0.14)" />
      <text x="48" y="58" text-anchor="middle" font-size="34">${glyph}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function getAvatarConfig() {
  return {
    emoji: state.avatarEmoji || AVATAR_EMOJI_OPTIONS[0],
    color: state.avatarColor || AVATAR_COLOR_OPTIONS[0],
  };
}

function renderUserAvatar(meta = {}) {
  const avatarEl = $('userAvatar');
  if (!avatarEl) return;
  const avatar = getAvatarConfig();
  avatarEl.src = buildAvatarSvgDataUri(avatar.emoji, avatar.color) || meta.avatar_url || meta.picture || '';
  avatarEl.alt = `Avatar ${state.playerName || 'Hunter'}`;
}

function getOAuthUrlState() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash);

  return {
    code: query.get('code'),
    accessToken: hash.get('access_token'),
    refreshToken: hash.get('refresh_token'),
    errorDescription: query.get('error_description') || hash.get('error_description'),
  };
}

async function consumeOAuthRedirect() {
  const { code, accessToken, refreshToken, errorDescription } = getOAuthUrlState();

  if (errorDescription) {
    clearOAuthUrlArtifacts();
    showAuthError(decodeURIComponent(errorDescription));
    return null;
  }

  if (code) {
    const { data, error } = await supabaseClient.auth.exchangeCodeForSession(window.location.href);
    clearOAuthUrlArtifacts();
    if (error) {
      console.error('[AUTH] exchangeCodeForSession error:', error);
      showAuthError(getSupabaseErrorMessage(error.message));
      return null;
    }
    return data?.session?.user || null;
  }

  if (accessToken && refreshToken) {
    const { data, error } = await supabaseClient.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    clearOAuthUrlArtifacts();
    if (error) {
      console.error('[AUTH] setSession error:', error);
      showAuthError(getSupabaseErrorMessage(error.message));
      return null;
    }
    return data?.session?.user || null;
  }

  return null;
}

// Login con Google
async function googleLogin() {
  if (_googleLoginPending) return;
  _googleLoginPending = true;

  const redirectTo = getOAuthRedirectUrl();
  if (!redirectTo) {
    _googleLoginPending = false;
    showAuthError('Apri l\'app da server locale o da GitHub Pages. Usa http://localhost:4173 invece di aprire il file direttamente.');
    return;
  }

  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        prompt: 'select_account'
      }
    }
  });
  if (error) {
    _googleLoginPending = false;
    showAuthError(getSupabaseErrorMessage(error.message));
    return;
  }

  if (data?.url) {
    window.location.assign(data.url);
    return;
  }

  _googleLoginPending = false;
}

// Login con Email/Password
async function emailLogin() {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email || !password) { showAuthError('Inserisci email e password.'); return; }
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) showAuthError(getSupabaseErrorMessage(error.message));
}

// Registrazione con Email/Password
async function emailRegister() {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email || !password) { showAuthError('Inserisci email e password.'); return; }
  if (password.length < 6) { showAuthError('La password deve avere almeno 6 caratteri.'); return; }
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    showAuthError(getSupabaseErrorMessage(error.message));
  } else {
    showAuthError('Account creato! Controlla la tua email per confermare.');
  }
}

// Reset password
async function forgotPassword() {
  const email = $('authEmail').value.trim();
  if (!email) { showAuthError('Inserisci la tua email per il reset.'); return; }
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  if (error) {
    showAuthError(getSupabaseErrorMessage(error.message));
  } else {
    showAuthError('Email di reset inviata! Controlla la posta.');
  }
}

// Logout
async function logout() {
  await saveState({ immediate: true });
  await supabaseClient.auth.signOut();
}

function getStorageKey(uid) {
  return uid ? `${STORAGE_KEY}:${uid}` : STORAGE_KEY;
}

function readStoredState(uid) {
  try {
    const raw = localStorage.getItem(getStorageKey(uid));
    if (!raw) return null;
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch (_) {
    return null;
  }
}

function writeStoredState(snapshot, uid = currentUser?.id) {
  const serialized = JSON.stringify(snapshot);
  localStorage.setItem(getStorageKey(), serialized);
  if (uid) localStorage.setItem(getStorageKey(uid), serialized);
}

function clearStoredState(uid = currentUser?.id) {
  localStorage.removeItem(getStorageKey());
  if (uid) localStorage.removeItem(getStorageKey(uid));
}

function normalizeState(snapshot) {
  const base = createFreshState();
  return {
    ...base,
    ...(snapshot || {}),
    stats: { ...base.stats, ...(snapshot?.stats || {}) },
    completedTodayIds: Array.isArray(snapshot?.completedTodayIds) ? snapshot.completedTodayIds : base.completedTodayIds,
    assessmentHistory: Array.isArray(snapshot?.assessmentHistory) ? snapshot.assessmentHistory : base.assessmentHistory,
    activeDebuffs: Array.isArray(snapshot?.activeDebuffs) ? snapshot.activeDebuffs : base.activeDebuffs,
    achievements: Array.isArray(snapshot?.achievements) ? snapshot.achievements : base.achievements,
    bossesDefeated: Array.isArray(snapshot?.bossesDefeated) ? snapshot.bossesDefeated : base.bossesDefeated,
    completedQuestLog: Array.isArray(snapshot?.completedQuestLog) ? snapshot.completedQuestLog : base.completedQuestLog,
    completedQuestDetails: Array.isArray(snapshot?.completedQuestDetails) ? snapshot.completedQuestDetails : base.completedQuestDetails,
    customQuests: Array.isArray(snapshot?.customQuests) ? snapshot.customQuests : base.customQuests,
    equipmentInventory: Array.isArray(snapshot?.equipmentInventory) ? snapshot.equipmentInventory : base.equipmentInventory,
    bossTitles: Array.isArray(snapshot?.bossTitles) ? snapshot.bossTitles : base.bossTitles,
    bucketListChecks: snapshot?.bucketListChecks && typeof snapshot.bucketListChecks === 'object' ? snapshot.bucketListChecks : base.bucketListChecks,
    equippedGear: snapshot?.equippedGear && typeof snapshot.equippedGear === 'object' ? snapshot.equippedGear : base.equippedGear,
    equipmentUpgrades: snapshot?.equipmentUpgrades && typeof snapshot.equipmentUpgrades === 'object' ? snapshot.equipmentUpgrades : base.equipmentUpgrades,
    materials: snapshot?.materials && typeof snapshot.materials === 'object' ? snapshot.materials : base.materials,
    flaskState: snapshot?.flaskState && typeof snapshot.flaskState === 'object' ? snapshot.flaskState : base.flaskState,
    startHere: snapshot?.startHere && typeof snapshot.startHere === 'object'
      ? { ...base.startHere, ...snapshot.startHere }
      : base.startHere,
  };
}

function getBestLocalState(uid) {
  return normalizeState(readStoredState(uid) || readStoredState() || createFreshState());
}

function createFreshState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

// Carica stato da Supabase (con timeout), con fallback su localStorage
async function loadStateFromCloud(uid) {
  // Prova dal cloud con timeout di 5 secondi
  try {
    const cloudPromise = supabaseClient
      .from('players')
      .select('state')
      .eq('id', uid)
      .maybeSingle();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Cloud load timeout')), 5000)
    );
    const { data, error } = await Promise.race([cloudPromise, timeoutPromise]);
    if (!error && data && data.state) {
      const merged = normalizeState(data.state);
      writeStoredState(merged, uid);
      return { state: merged, found: true };
    }
    if (error) console.warn('Supabase load error:', error);
  } catch (e) {
    console.warn('Supabase load error:', e);
  }
  return { state: getBestLocalState(uid), found: false };
}

// Salva su Supabase + localStorage (debounced)
async function saveStateNow() {
  writeStoredState(state);
  if (!currentUser) return { error: null };
  const { error } = await supabaseClient
    .from('players')
    .upsert({ id: currentUser.id, state: state });
  if (error) console.warn('Supabase save error:', error);
  return { error };
}

function saveState(options = {}) {
  const { immediate = false } = options;
  writeStoredState(state);
  if (!currentUser) return immediate ? Promise.resolve({ error: null }) : undefined;

  clearTimeout(_saveTimeout);

  if (immediate) {
    return saveStateNow();
  }

  _saveTimeout = setTimeout(() => {
    saveStateNow();
  }, 1000);
}

// Funzione che gestisce l'ingresso nell'app dopo l'auth
let _appEntered = false;
let _initDone = false;

function initOnce() {
  if (_initDone) return;
  _initDone = true;
  init();
}

async function enterApp(user) {
  if (_appEntered) return;
  _appEntered = true;
  currentUser = user;
  state = getBestLocalState(user.id);
  $('loginScreen').classList.add('hidden');

  // Mostra subito la schermata corretta per evitare il flash nero
  if (state.onboardingDone) {
    $('onboarding').classList.add('hidden');
    $('mainApp').classList.remove('hidden');
  } else {
    $('onboarding').classList.remove('hidden');
    $('mainApp').classList.add('hidden');
  }
  setTimeout(syncAppChromeMetrics, 0);

  const meta = user.user_metadata || {};
  renderUserAvatar(meta);
  $('userEmail').textContent = user.email || '';

  // Inizializza subito la UI con lo stato locale/default.
  _initDone = false;
  init();

  // Carica dal cloud in background e aggiorna solo quando pronto.
  try {
    const { state: cloudState, found } = await loadStateFromCloud(user.id);
    const currentStateJson = JSON.stringify(state);
    const cloudStateJson = JSON.stringify(cloudState);
    state = cloudState;
    writeStoredState(state, user.id);
    if (cloudStateJson !== currentStateJson) {
      _initDone = false;
      init();
    }
    if (!found && state.onboardingDone) {
      await saveState({ immediate: true });
    }
  } catch (e) {
    console.warn('Cloud load failed, using local state');
  }

  // Failsafe: evita schermata nera in caso di race condition tra callback auth/UI
  setTimeout(ensureAppVisibility, 0);
}

function showLogin() {
  _appEntered = false;
  currentUser = null;
  if ($('loginScreen')) {
    $('loginScreen').classList.remove('hidden');
    $('onboarding')?.classList.add('hidden');
    $('mainApp')?.classList.add('hidden');
  }
}

// ── Auth: gestisce solo eventi LIVE (logout, login) ──
supabaseClient.auth.onAuthStateChange(async (event, session) => {
  await _domReadyPromise;
  console.log('[AUTH] event:', event);
  if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
    _googleLoginPending = false;
  }
  if (event === 'SIGNED_OUT') {
    showLogin();
  } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user && !_appEntered) {
    enterApp(session.user);
  }
});

async function bootstrapAuth() {
  try {
    const oauthUser = await consumeOAuthRedirect();
    if (oauthUser) {
      enterApp(oauthUser);
      return;
    }

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;

    if (data?.session?.user) {
      enterApp(data.session.user);
    } else if (!state.onboardingDone) {
      showLogin();
    }
  } catch (e) {
    console.error('[AUTH] getSession error:', e);
    if (!state.onboardingDone) showLogin();
  } finally {
    setTimeout(ensureAppVisibility, 0);
  }
}

// ── Inizializzazione su DOMContentLoaded ──
document.addEventListener('DOMContentLoaded', () => {
  syncAppChromeMetrics();
  window.addEventListener('resize', syncAppChromeMetrics);
  window.addEventListener('pointerdown', unlockSystemAudio, { once: true });
  window.addEventListener('keydown', unlockSystemAudio, { once: true });

  // 1. SEMPRE init() subito con i dati locali (state è già caricato da loadState())
  if (state.onboardingDone) {
    $('loginScreen').classList.add('hidden');
    $('onboarding').classList.add('hidden');
    $('mainApp').classList.remove('hidden');
    initOnce();
  }

  // 2. Supabase auth check in background (non blocca la UI)
  bootstrapAuth();
});

// Event listeners login/logout
document.addEventListener('DOMContentLoaded', () => {
  $('btnGoogleLogin').addEventListener('click', googleLogin);
  $('btnEmailLogin').addEventListener('click', emailLogin);
  $('btnEmailRegister').addEventListener('click', emailRegister);
  $('btnForgotPassword').addEventListener('click', forgotPassword);
  $('btnLogout').addEventListener('click', logout);
  // Enter key per login rapido
  $('authPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') emailLogin();
  });
});

// ========================
// STAT DEFINITIONS
// ========================

const PRIMARY_STATS = [
  { id:'STR', name:'Forza',       icon:'💪', color:'#FF55BB', maxLv:99 },
  { id:'RES', name:'Resistenza',  icon:'🛡️', color:'#FF8844', maxLv:99 },
  { id:'AGI', name:'Agilità',     icon:'⚡', color:'#44DDFF', maxLv:99 },
  { id:'INT', name:'Intelligenza',icon:'🧠', color:'#00FFCC', maxLv:99 },
  { id:'WIL', name:'Volontà',     icon:'🔥', color:'#FFB800', maxLv:99 },
  { id:'CHA', name:'Carisma',     icon:'👁', color:'#BB77FF', maxLv:99 },
];

const SECONDARY_STATS = [
  { id:'FOC', name:'Focus',          icon:'🎯', color:'#33BBFF', maxLv:50, derivedFrom:['INT','WIL'] },
  { id:'RSL', name:'Resilienza',     icon:'💎', color:'#FF6644', maxLv:50, derivedFrom:['WIL','RES'] },
  { id:'DIS', name:'Disciplina',     icon:'⚙️', color:'#AABB44', maxLv:50, derivedFrom:['WIL','INT'] },
  { id:'EMP', name:'Empatia',        icon:'💜', color:'#DD66FF', maxLv:50, derivedFrom:['CHA','WIL'] },
  { id:'VAG', name:'Tono Vagale',    icon:'🫁', color:'#44FF88', maxLv:50, derivedFrom:['RES','CHA'] },
  { id:'CO2', name:'Tolleranza CO2', icon:'🌬️', color:'#66CCDD', maxLv:50, derivedFrom:['RES','STR'] },
  { id:'CRE', name:'Creatività',     icon:'🎨', color:'#FF44AA', maxLv:50, derivedFrom:['INT','AGI'] },
  { id:'LEA', name:'Leadership',     icon:'👑', color:'#FFD700', maxLv:50, derivedFrom:['CHA','INT'] },
  { id:'ADA', name:'Adattabilità',   icon:'🔄', color:'#44FFCC', maxLv:50, derivedFrom:['AGI','WIL'] },
  { id:'VIT', name:'Vitalità',       icon:'❤️', color:'#FF4466', maxLv:50, derivedFrom:['STR','RES'] },
];

// ========================
// CLASS DEFINITIONS
// ========================

const CLASS_DEFINITIONS = [
  { id:'WARRIOR',   name:'WARRIOR',        icon:'⚔️', primary:['STR','RES'], desc:'Corpo temprato dalla disciplina. Forza e resistenza sono le tue armi.' },
  { id:'SCHOLAR',   name:'SCHOLAR',        icon:'📚', primary:['INT','DIS'], desc:'La mente è il tuo campo di battaglia. Conoscenza e disciplina ti guidano.' },
  { id:'SHADOW',    name:'SHADOW',         icon:'🌑', primary:['AGI','WIL'], desc:'Veloce e indomabile. Ti muovi nell\'ombra con determinazione letale.' },
  { id:'DIPLOMAT',  name:'DIPLOMAT',       icon:'🤝', primary:['CHA','EMP'], desc:'Le relazioni sono il tuo potere. Empatia e carisma piegano la realtà.' },
  { id:'BIOHACKER', name:'BIOHACKER',      icon:'🧬', primary:['RES','INT'], desc:'Il corpo è il tuo laboratorio. Scienza e resilienza ti trasformano.' },
  { id:'MONK',      name:'MONK',           icon:'🧘', primary:['WIL','VAG'], desc:'Controllo totale di mente e sistema nervoso. La calma è la tua forza.' },
  { id:'LEADER',    name:'LEADER',         icon:'👑', primary:['CHA','LEA'], desc:'Nato per guidare. Il tuo carisma e visione ispirano chi ti circonda.' },
  { id:'ARTIST',    name:'CREATIVE MIND',  icon:'🎨', primary:['INT','CRE'], desc:'Pensiero divergente e intuizione. Vedi soluzioni dove altri vedono muri.' },
];

const TRAIT_SIGNAL_MAP = {
  disciplina: { stats:['DIS','WIL'], questIds:['deep_work','quiver_zero_protocol','meditation'], bossIds:['PROCRASTINATION_LEECH','PERFECTION_JUDGE'] },
  procrastinazione: { stats:['DIS','FOC'], questIds:['deep_work','quiver_zero_protocol','strategic_reading'], bossIds:['PROCRASTINATION_LEECH','PERFECTION_JUDGE'] },
  focus: { stats:['FOC','INT'], questIds:['deep_work','monarch_helm_scan','azure_flask_sync'], bossIds:['PROCRASTINATION_LEECH','PERFECTION_JUDGE'] },
  ansia: { stats:['VAG','CO2'], questIds:['vagal_reset','box_breathing','vagal_amulet_recovery'], bossIds:['ANXIETY_WRAITH','PANIC_HYDRA'] },
  panico: { stats:['VAG','CO2'], questIds:['box_breathing','vagal_reset','co2_loop_dive'], bossIds:['PANIC_HYDRA','ANXIETY_WRAITH'] },
  rabbia: { stats:['VAG','EMP'], questIds:['meditation','vagal_reset','social_exposure'], bossIds:['ANGER_BERSERKER'] },
  vergogna: { stats:['CHA','WIL','EMP'], questIds:['social_exposure','public_speaking','empathy_training'], bossIds:['SHAME_SIREN'] },
  giudizio: { stats:['CHA','WIL'], questIds:['public_speaking','social_exposure'], bossIds:['SHAME_SIREN','PERFECTION_JUDGE'] },
  paura: { stats:['WIL','VAG'], questIds:['meditation','box_breathing','social_exposure'], bossIds:['ANXIETY_WRAITH','PANIC_HYDRA','SHAME_SIREN'] },
  fallire: { stats:['WIL','DIS'], questIds:['deep_work','meditation','strategic_reading'], bossIds:['PERFECTION_JUDGE','DESPAIR_PHANTOM'] },
  espormi: { stats:['CHA','EMP'], questIds:['social_exposure','public_speaking','empathy_training'], bossIds:['SHAME_SIREN','ISOLATION_WEAVER'] },
  controllo: { stats:['WIL','DIS'], questIds:['meditation','deep_work','creative_block'], bossIds:['PERFECTION_JUDGE','ANXIETY_WRAITH'] },
  sociale: { stats:['CHA','EMP'], questIds:['social_exposure','empathy_training','public_speaking'], bossIds:['ISOLATION_WEAVER','SHAME_SIREN'] },
  empatia: { stats:['EMP','CHA'], questIds:['empathy_training','social_exposure','vagal_amulet_recovery'], bossIds:['ISOLATION_WEAVER','ANGER_BERSERKER'] },
  leadership: { stats:['LEA','CHA'], questIds:['public_speaking','social_exposure'], bossIds:['SHAME_SIREN','ENVY_CHIMERA'] },
  forza: { stats:['STR','RES'], questIds:['strength','iron_heart_forge','calisthenics'], bossIds:['LETHARGY_GOLEM','ANGER_BERSERKER'] },
  resistenza: { stats:['RES','VIT'], questIds:['endurance_run','cardio_hiit','iron_heart_forge'], bossIds:['LETHARGY_GOLEM','DESPAIR_PHANTOM'] },
  creativita: { stats:['CRE','INT'], questIds:['creative_block','memory_palace'], bossIds:['ENVY_CHIMERA','PERFECTION_JUDGE'] },
  perfezionismo: { stats:['DIS','FOC'], questIds:['creative_block','deep_work','strategic_reading'], bossIds:['PERFECTION_JUDGE'] },
  isolamento: { stats:['EMP','CHA','VAG'], questIds:['social_exposure','empathy_training','vagal_reset'], bossIds:['ISOLATION_WEAVER'] },
  invidia: { stats:['ADA','WIL'], questIds:['meditation','creative_block','strategic_reading'], bossIds:['ENVY_CHIMERA'] },
  confronto: { stats:['ADA','WIL'], questIds:['meditation','creative_block','deep_work'], bossIds:['ENVY_CHIMERA'] },
  letargia: { stats:['RES','VIT','FOC'], questIds:['cold_exposure','movement_prime','endurance_run'], bossIds:['LETHARGY_GOLEM','DESPAIR_PHANTOM'] },
  stanchezza: { stats:['VIT','RES'], questIds:['cold_exposure','endurance_run','crimson_flask_brew'], bossIds:['LETHARGY_GOLEM'] },
};

const TRAIT_SOURCE_LABELS = {
  strengths: 'Leva di build',
  weaknesses: 'Frattura da correggere',
  fears: 'Boss interiore',
};

function normalizePlainText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getTraitSignals(text) {
  const normalized = normalizePlainText(text);
  return Object.entries(TRAIT_SIGNAL_MAP)
    .filter(([keyword]) => normalized.includes(keyword))
    .map(([keyword, config]) => ({ keyword, ...config }));
}

// ========================
// QUEST DEFINITIONS
// ========================

const QUEST_DEFINITIONS = [
  {
    id:'vagal_reset', name:'Vagal Reset', desc:'Ripristina l\'equilibrio del SNA tramite stimolazione vagale.',
    type:'RECOVERY', cat:'NEURAL', diff:2, dur:10, req:[], timed:false,
    rewards:[{stat:'VAG',xp:30},{stat:'CHA',xp:15}],
    protocol:['Posizione supina, gambe elevate a 90°','Respirazione diaframmatica: 4s inspirazione, 8s espirazione','Massaggio del seno carotideo (leggero, bilaterale, 30s)','Gargarismo con acqua fredda per 30s','Cold exposure: immersione del viso in acqua fredda 10-15°C per 30s'],
    science:'La stimolazione del nervo vago attiva il sistema parasimpatico, riducendo cortisolo e norepinefrina.', icon:'🫁'
  },
  {
    id:'box_breathing', name:'Box Breathing Protocol', desc:'Protocollo di respirazione quadrata per stabilizzazione del SNA.',
    type:'DAILY', cat:'NEURAL', diff:3, dur:8, req:[], timed:false,
    rewards:[{stat:'VAG',xp:25},{stat:'CO2',xp:20},{stat:'FOC',xp:10}],
    protocol:['Posizione seduta eretta, spalle rilassate','Inspirare per 4 secondi (nasale)','Trattenere il respiro per 4 secondi','Espirare per 4 secondi (nasale)','Trattenere il respiro per 4 secondi','Ripetere per 5 minuti (8 cicli minimo)'],
    science:'Il pattern 4-4-4-4 equalizza il rapporto simpatico/parasimpatico.', icon:'🌬️'
  },
  {
    id:'deep_work', name:'Deep Work Dungeon', desc:'Sessione di lavoro profondo con eliminazione delle distrazioni.',
    type:'DAILY', cat:'COGNITIVE', diff:7, dur:90, req:[{stat:'FOC',minLv:3}], timed:true,
    rewards:[{stat:'FOC',xp:60},{stat:'INT',xp:40},{stat:'DIS',xp:25}],
    protocol:['Disattiva TUTTE le notifiche (telefono in modalità aereo)','Definisci un singolo obiettivo misurabile','Timer: 90 minuti senza interruzioni','Se la mente divaga, appunta e ritorna al focus','Al termine: 10 minuti di riposo attivo'],
    science:'Il deep work attiva la corteccia prefrontale dorsolaterale e induce uno stato di flow dopaminergico.', icon:'🧠'
  },
  {
    id:'cold_exposure', name:'Protocollo Cold Exposure', desc:'Esposizione controllata al freddo per resilienza neurochimica.',
    type:'DAILY', cat:'PHYSIQUE', diff:6, dur:15, req:[{stat:'VAG',minLv:2}], timed:true,
    rewards:[{stat:'CO2',xp:40},{stat:'VAG',xp:25},{stat:'RES',xp:30},{stat:'WIL',xp:20}],
    protocol:['Inizia con 30s di respirazione controllata','Doccia fredda: inizia con 30s e aumenta','Mantieni la respirazione nasale','NON iperventilare — controllo del brivido','Terminare con 2 minuti di respirazione normale'],
    science:'Il cold stress aumenta norepinefrina del 200-300% e attiva il tessuto adiposo bruno.', icon:'🧊'
  },
  {
    id:'vestibular', name:'Vestibular Calibration', desc:'Allenamento del sistema vestibolare per equilibrio e orientamento.',
    type:'DAILY', cat:'NEURAL', diff:4, dur:15, req:[], timed:true,
    rewards:[{stat:'AGI',xp:35},{stat:'FOC',xp:15},{stat:'ADA',xp:20}],
    protocol:['Stazione eretta su una gamba, occhi chiusi — 30s per lato','Rotazioni della testa lente — 10 ripetizioni','Camminata su linea retta con rotazione della testa — 3 tratti','Posizione tandem con perturbazioni — 60s'],
    science:'La stimolazione vestibolare migliora la connettività cerebellare e riduce la cinetosi.', icon:'⚖️'
  },
  {
    id:'strength', name:'Protocollo Forza Neurale', desc:'Allenamento di forza massimale con focus sul reclutamento neurale.',
    type:'DAILY', cat:'PHYSIQUE', diff:8, dur:45, req:[{stat:'STR',minLv:3},{stat:'VIT',minLv:2}], timed:true,
    rewards:[{stat:'STR',xp:55},{stat:'VIT',xp:20},{stat:'RES',xp:15}],
    protocol:['Warm-up: 5 min di mobilità articolare dinamica','Attivazione neurale: 3x3 salti con atterraggio controllato','Esercizio principale: 5x3 al 85% 1RM (riposo 3-5 min)','Accessorio: 3x8 a intensità moderata','Cool-down: respirazione diaframmatica 3 min'],
    science:'Il carico sub-massimale (85%+ 1RM) migliora il rate coding e la sincronizzazione delle unità motorie.', icon:'💪'
  },
  {
    id:'social_exposure', name:'Social Calibration', desc:'Esposizione sociale progressiva per rafforzare il carisma.',
    type:'DAILY', cat:'SOCIAL', diff:5, dur:30, req:[{stat:'CHA',minLv:2}], timed:false,
    rewards:[{stat:'CHA',xp:40},{stat:'EMP',xp:25},{stat:'LEA',xp:15}],
    protocol:['Inizia una conversazione con uno sconosciuto','Mantieni contatto visivo per almeno 3 secondi','Fai una domanda aperta e ascolta attivamente','Esprimi un apprezzamento genuino','Rifletti sull\'interazione per 2 minuti'],
    science:'L\'esposizione sociale controllata riduce l\'amigdala reattiva e rafforza i circuiti di ricompensa sociale.', icon:'🤝'
  },
  {
    id:'creative_block', name:'Creative Burst', desc:'Sessione di pensiero divergente e problem-solving creativo.',
    type:'DAILY', cat:'COGNITIVE', diff:5, dur:25, req:[{stat:'CRE',minLv:2}], timed:true,
    rewards:[{stat:'CRE',xp:45},{stat:'INT',xp:20},{stat:'ADA',xp:15}],
    protocol:['Scegli un problema o progetto','Brainstorming libero: scrivi 20 idee in 10 minuti','Seleziona le 3 migliori e sviluppale','Connetti idee apparentemente non correlate','Sketch/prototipa la soluzione migliore'],
    science:'Il pensiero divergente attiva la default mode network in sinergia con la corteccia prefrontale.', icon:'🎨'
  },
  {
    id:'meditation', name:'Mindfulness Protocol', desc:'Meditazione guidata per potenziare focus e controllo emotivo.',
    type:'DAILY', cat:'NEURAL', diff:3, dur:20, req:[], timed:false,
    rewards:[{stat:'WIL',xp:30},{stat:'FOC',xp:25},{stat:'RSL',xp:20}],
    protocol:['Seduto con schiena dritta, occhi chiusi','Focus sul respiro: osserva senza modificare','Quando la mente divaga, nota e ritorna al respiro','Body scan: dalla testa ai piedi, 3 minuti','Chiudi con 1 minuto di consapevolezza aperta'],
    science:'La meditazione aumenta la materia grigia nella corteccia prefrontale e riduce l\'attività dell\'amigdala.', icon:'🧘'
  },
  {
    id:'cardio_hiit', name:'HIIT Neural Boost', desc:'High-Intensity Interval Training per output cardiovascolare.',
    type:'DAILY', cat:'PHYSIQUE', diff:7, dur:30, req:[{stat:'RES',minLv:3}], timed:true,
    rewards:[{stat:'RES',xp:45},{stat:'VIT',xp:30},{stat:'ADA',xp:15}],
    protocol:['Warm-up: 5 min a bassa intensità','20 secondi all-out / 40 secondi rest — 8 round','Recupero attivo: camminata 3 minuti','Ripetere per 3 serie totali','Cool-down: 5 min stretching + respirazione'],
    science:'L\'HIIT aumenta BDNF e neurogenesi nell\'ippocampo, migliorando plasticità cerebrale.', icon:'🏃'
  },
  // ===== PHYSICAL EXTRA =====
  {
    id:'sprint_intervals', name:'Sprint Protocol', desc:'Sprint ad alta intensità con recupero attivo. Potenza esplosiva.',
    type:'DAILY', cat:'PHYSIQUE', diff:8, dur:25, req:[{stat:'AGI',minLv:3},{stat:'RES',minLv:3}], timed:true,
    rewards:[{stat:'AGI',xp:50},{stat:'RES',xp:30},{stat:'VIT',xp:25}],
    protocol:['Warm-up: 5 min di corsetta + mobilità caviglie','Sprint 30m x 6 ripetizioni (recupero 90s)','Sprint in salita 20m x 4 ripetizioni (recupero 120s)','Cool-down: 5 min di camminata + stretching dinamico'],
    science:'Lo sprint massimale recluta le fibre tipo II e aumenta il testosterone fino al 40%.', icon:'⚡'
  },
  {
    id:'pull_up_gauntlet', name:'Pull-Up Gauntlet', desc:'Progressione trazioni per forza della parte superiore del corpo.',
    type:'DAILY', cat:'PHYSIQUE', diff:7, dur:30, req:[{stat:'STR',minLv:2}], timed:true,
    rewards:[{stat:'STR',xp:50},{stat:'RES',xp:25},{stat:'DIS',xp:15}],
    protocol:['Attivazione: 2x5 scapular pulls','3 serie al numero massimo (rest 2-3 min)','Negative: 3x5 discesa controllata 5s','Isometric hold: 3x max hold alla barra','Stretching: spalle e dorsali 3 min'],
    science:'Le trazioni attivano oltre il 70% della muscolatura del tronco superiore, stimolando il GH.', icon:'🏋️'
  },
  {
    id:'mobility_flow', name:'Mobility Flow', desc:'Sessione di mobilità articolare completa per flessibilità e prevenzione.',
    type:'DAILY', cat:'PHYSIQUE', diff:3, dur:20, req:[], timed:false,
    rewards:[{stat:'AGI',xp:30},{stat:'VIT',xp:20},{stat:'ADA',xp:15}],
    protocol:['CARs (Controlled Articular Rotations): tutte le articolazioni','Squat profondo: 2 min di tenuta','Ponte: 3x10 con hold in alto','90/90 hip stretch: 60s per lato','World\'s greatest stretch: 5 per lato'],
    science:'La mobilità articolare attiva migliora la propriocezione e riduce il rischio di infortunio del 50%.', icon:'🤸'
  },
  {
    id:'endurance_run', name:'Zone 2 Endurance',desc:'Corsa a bassa intensità in zona 2 per resistenza aerobica.',
    type:'DAILY', cat:'PHYSIQUE', diff:5, dur:40, req:[{stat:'RES',minLv:2}], timed:true,
    rewards:[{stat:'RES',xp:40},{stat:'VIT',xp:30},{stat:'CO2',xp:20}],
    protocol:['Warm-up: 5 min camminata veloce','Corsa Zone 2 (60-70% FC max) per 30 min','Mantieni respirazione nasale il più possibile','Non parlare durante lo sforzo (MAF test)','Cool-down: 5 min camminata + stretching'],
    science:'L\'esercizio in zona 2 massimizza la biogenesi mitocondriale e la capacità ossidativa.', icon:'🏃‍♂️'
  },
  {
    id:'calisthenics', name:'Calisthenics Arena', desc:'Circuito a corpo libero per forza funzionale e coordinazione.',
    type:'DAILY', cat:'PHYSIQUE', diff:6, dur:35, req:[{stat:'STR',minLv:2},{stat:'AGI',minLv:2}], timed:true,
    rewards:[{stat:'STR',xp:40},{stat:'AGI',xp:30},{stat:'VIT',xp:20},{stat:'DIS',xp:10}],
    protocol:['Warm-up: bear crawl + crab walk 3 min','Circuito: 10 push-up + 10 squat + 10 dips + 5 burpees','Ripetere il circuito 4 volte (rest 60s tra circuiti)','Core: plank 60s + hollow hold 45s + side plank 30s/lato','Cool-down: stretching statico 5 min'],
    science:'Il calisthenics migliora la forza relativa e la coordinazione inter-muscolare globale.', icon:'🤸‍♂️'
  },
  // ===== SOCIAL EXTRA =====
  {
    id:'public_speaking', name:'Public Speaking Trial', desc:'Esposizione al parlare in pubblico con desensibilizzazione progressiva.',
    type:'DAILY', cat:'SOCIAL', diff:8, dur:30, req:[{stat:'CHA',minLv:4},{stat:'WIL',minLv:3}], timed:false,
    rewards:[{stat:'CHA',xp:55},{stat:'LEA',xp:30},{stat:'WIL',xp:25},{stat:'RSL',xp:15}],
    protocol:['Prepara un discorso di 3 minuti su un argomento che conosci','Registrati mentre lo pronunci (video)','Riguarda il video e nota 3 punti da migliorare','Ripeti il discorso davanti a 1+ persone o in live','Rifletti su come ti sei sentito prima/dopo'],
    science:'L\'esposizione graduata al public speaking riduce il cortisolo reattivo e rafforza la corteccia prefrontale mediale.', icon:'🎤'
  },
  {
    id:'empathy_training', name:'Empathy Protocol', desc:'Allenamento attivo dell\'empatia e dell\'ascolto profondo.',
    type:'DAILY', cat:'SOCIAL', diff:4, dur:20, req:[], timed:false,
    rewards:[{stat:'EMP',xp:40},{stat:'CHA',xp:20},{stat:'VAG',xp:15}],
    protocol:['Scegli una persona con cui interagire','Pratica l\'ascolto attivo: ripeti, conferma, non interrompere','Identifica l\'emozione dell\'altro e verbalizzala','Chiediti: "Cosa proverei io al suo posto?"','Scrivi 3 insight dall\'interazione'],
    science:'L\'ascolto attivo aumenta l\'attivazione dei neuroni specchio e rafforza la corteccia insulare.', icon:'💜'
  },
  // ===== COGNITIVE EXTRA =====
  {
    id:'memory_palace', name:'Memory Palace', desc:'Costruisci un palazzo della memoria per potenziare la memorizzazione.',
    type:'DAILY', cat:'COGNITIVE', diff:6, dur:25, req:[{stat:'INT',minLv:3}], timed:true,
    rewards:[{stat:'INT',xp:45},{stat:'CRE',xp:25},{stat:'FOC',xp:20}],
    protocol:['Scegli un percorso familiare con 10 "stanze"','Associa un\'informazione da ricordare ad ogni stanza','Usa immagini vivide, assurde e multisensoriali','Percorri il palazzo mentalmente 3 volte','Test: prova a richiamare tutte le 10 informazioni'],
    science:'Il metodo dei loci sfrutta la memoria spaziale dell\'ippocampo per codifica superiore.', icon:'🏛️'
  },
  {
    id:'strategic_reading', name:'Strategic Reading', desc:'Lettura profonda con annotazione attiva e sintesi.',
    type:'DAILY', cat:'COGNITIVE', diff:4, dur:30, req:[], timed:true,
    rewards:[{stat:'INT',xp:35},{stat:'FOC',xp:20},{stat:'DIS',xp:15}],
    protocol:['Scegli un testo non-fiction impegnativo','Leggi 20 pagine con attenzione totale','Sottolinea/annota concetti chiave (max 3 per pagina)','Alla fine scrivi un riassunto in 3 frasi','Identifica 1 azione concreta derivata dalla lettura'],
    science:'La lettura profonda attiva la corteccia prefrontale e il default mode network in sinergia.', icon:'📖'
  },
];

// ========================
// DIFFICULTY MODES
// ========================

const DIFFICULTY_MODES = {
  easy:   { label:'FACILE',   icon:'🟢', xpMult:0.6,  diffOffset:-2, color:'#00FF88' },
  medium: { label:'MEDIA',    icon:'🟡', xpMult:1.0,  diffOffset:0,  color:'#FFB800' },
  hard:   { label:'DIFFICILE',icon:'🔴', xpMult:1.5,  diffOffset:+2, color:'#FF3366' },
};

// Time bonus: ratio of (target / actual). >1 = faster than expected.
function calcTimeBonus(quest, elapsedSec) {
  const targetSec = quest.dur * 60;
  if (elapsedSec <= 0) return 1;
  const ratio = targetSec / elapsedSec;
  // Faster: up to 1.5x bonus. Slower: minimum 0.5x.
  if (ratio >= 2)   return 1.5;
  if (ratio >= 1)   return 1 + (ratio - 1) * 0.5;
  if (ratio >= 0.5) return 0.75 + (ratio - 0.5) * 0.5;
  return 0.5;
}

function getTimeBonusLabel(mult) {
  if (mult >= 1.4) return { label:'VELOCISSIMO!', color:'#FFD700' };
  if (mult >= 1.2) return { label:'VELOCE!', color:'#00FFCC' };
  if (mult >= 1.0) return { label:'NEL TEMPO', color:'#00FF88' };
  if (mult >= 0.7) return { label:'LENTO', color:'#FFB800' };
  return { label:'TROPPO LENTO', color:'#FF3366' };
}

// ========================
// BOSS DEFINITIONS
// ========================

const BOSS_DEFINITIONS = [
  {
    id:'ANXIETY_WRAITH', name:'Anxiety Wraith', title:"Lo Spettro dell'Ansia",
    desc:"Un'entità che si nutre dei segnali di errore del sistema predittivo del cervello.",
    emotionLabel:'ALLERTA / PAURA ANTICIPATORIA', themeClass:'anxiety', quote:'Non ogni allarme merita obbedienza.', titleReward:'Wraithbreaker',
    maxHP:100, level:1, icon:'👻',
    req:[{stat:'VAG',minLv:5},{stat:'CO2',minLv:3}],
    protocol:[
      {instr:'BOX BREATHING: Inspira 4s → Trattieni 4s → Espira 4s → Trattieni 4s. Ripeti 6 volte.', dur:120},
      {instr:'GROUNDING 5-4-3-2-1: Nomina 5 cose che vedi, 4 che tocchi, 3 che senti, 2 che annusi, 1 che gusti.', dur:60},
      {instr:'COLD EXPOSURE: Immergi il viso in acqua fredda (10-15°C) per 30 secondi.', dur:45},
      {instr:'COGNITIVE REFRAME: Verbalizza "Questo è un segnale di attivazione, non di pericolo reale."', dur:30},
      {instr:'VAGAL BRAKE: Espirazione prolungata 4s-in / 8s-out per 3 minuti.', dur:180},
    ],
    rewards:[{stat:'VAG',xp:100},{stat:'CHA',xp:50},{stat:'CO2',xp:50},{stat:'FOC',xp:40}],
  },
  {
    id:'LETHARGY_GOLEM', name:'Lethargy Golem', title:'Il Golem della Letargia',
    desc:'Massa inerte che drena motivazione. Rallenta il metabolismo e offusca la mente.',
    emotionLabel:'STASI / BASSA ATTIVAZIONE', themeClass:'lethargy', quote:'Il corpo si sveglia quando l’inerzia viene insultata dal movimento.', titleReward:'Spark Carrier',
    maxHP:120, level:2, icon:'🗿',
    req:[{stat:'RES',minLv:4},{stat:'FOC',minLv:3}],
    protocol:[
      {instr:'COLD SHOWER BLAST: 60 secondi di doccia ghiacciata. Mantieni respirazione nasale.', dur:90},
      {instr:'MOVEMENT PRIME: 20 jumping jacks + 10 squat esplosivi + 10 push-ups.', dur:120},
      {instr:'SUNLIGHT EXPOSURE: 10 minuti di esposizione alla luce solare diretta.', dur:600},
      {instr:'MICRO-COMMITMENT: Scegli UNA azione da 2 minuti e completala ORA.', dur:120},
    ],
    rewards:[{stat:'RES',xp:80},{stat:'FOC',xp:70},{stat:'VIT',xp:50}],
  },
  {
    id:'PROCRASTINATION_LEECH', name:'Procrastination Leech', title:'La Sanguisuga della Procrastinazione',
    desc:"Parassita che offre gratificazione immediata svuotando quella a lungo termine.",
    emotionLabel:'ATTRITO / EVITAMENTO', themeClass:'procrastination', quote:'Il primo minuto è il vero mostro. Dopo, resta solo lavoro.', titleReward:'Deadline Reaper',
    maxHP:130, level:2, icon:'🩸',
    req:[{stat:'FOC',minLv:4},{stat:'DIS',minLv:3}],
    protocol:[
      {instr:"TEMPTATION BUNDLING: Accoppia un compito difficile con un'attività piacevole.", dur:60},
      {instr:'RULE OF TWO MINUTES: Inizia il compito che stai evitando. Solo 2 minuti.', dur:120},
      {instr:'ENVIRONMENT DESIGN: Rimuovi fisicamente le 3 distrazioni principali.', dur:180},
      {instr:'ACCOUNTABILITY BROADCAST: Comunica a qualcuno il tuo obiettivo e la deadline.', dur:60},
    ],
    rewards:[{stat:'FOC',xp:90},{stat:'DIS',xp:60},{stat:'WIL',xp:40}],
  },
  {
    id:'ANGER_BERSERKER', name:'Anger Berserker', title:'Il Berserker della Rabbia',
    desc:'Forza bruta che consuma energia e distrugge relazioni.',
    emotionLabel:'FUOCO / IMPULSO', themeClass:'anger', quote:'La rabbia disciplinata diventa lama; quella cieca diventa gabbia.', titleReward:'Ember Sovereign',
    maxHP:150, level:3, icon:'🔥',
    req:[{stat:'VAG',minLv:7},{stat:'EMP',minLv:5},{stat:'CO2',minLv:5}],
    protocol:[
      {instr:'PHYSIOLOGICAL SIGH: Doppia inspirazione nasale rapida + espirazione lenta orale. Ripeti 8 volte.', dur:60},
      {instr:'BILATERAL STIMULATION: Tapping alternato sulle ginocchia, 1 Hz, per 2 minuti.', dur:120},
      {instr:'PERSPECTIVE SHIFT: Descrivi la situazione in terza persona, come un narratore neutrale.', dur:90},
      {instr:'ISOMETRIC TENSION RELEASE: Contrai tutti i muscoli al 100% per 10s, poi rilascia. 3 volte.', dur:60},
    ],
    rewards:[{stat:'VAG',xp:120},{stat:'EMP',xp:80},{stat:'RSL',xp:60}],
  },
  {
    id:'DESPAIR_PHANTOM', name:'Despair Phantom', title:'Il Fantasma della Disperazione',
    desc:"Un'ombra che svuota di significato ogni azione. Paralisi motivazionale profonda.",
    emotionLabel:'VUOTO / COLLASSO', themeClass:'despair', quote:'Anche un passo senza speranza resta un passo contro il nulla.', titleReward:'Void Survivor',
    maxHP:180, level:4, icon:'🌑',
    req:[{stat:'VAG',minLv:8},{stat:'FOC',minLv:6},{stat:'RES',minLv:5},{stat:'EMP',minLv:4}],
    protocol:[
      {instr:"MOVEMENT INTERVENTION: 20 minuti di camminata veloce all'aperto.", dur:1200},
      {instr:'GRATITUDE ACTIVATION: Scrivi 3 cose concrete di cui sei grato e spiega PERCHÉ.', dur:300},
      {instr:'SOCIAL CONNECTION: Chiama o scrivi a UNA persona cara. Conversazione autentica 5 min.', dur:300},
      {instr:'VALUE RECONNECTION: Scrivi in 60 secondi "Per cosa vale la pena lottare?".', dur:90},
    ],
    rewards:[{stat:'VAG',xp:150},{stat:'FOC',xp:100},{stat:'EMP',xp:90},{stat:'RES',xp:60}],
  },
  {
    id:'SHAME_SIREN', name:'Shame Siren', title:'La Sirena della Vergogna',
    desc:'Canta giudizi interiori finché smetti di esporti e torni invisibile.',
    emotionLabel:'VERGOGNA / AUTO-SVALUTAZIONE', themeClass:'shame', quote:'Mostrarti imperfetto è già una forma di dominio.', titleReward:'Unmasked One',
    maxHP:200, level:5, icon:'🎭',
    req:[{stat:'CHA',minLv:6},{stat:'WIL',minLv:6},{stat:'EMP',minLv:5}],
    protocol:[
      {instr:'POSTURA DI PRESENZA: petto aperto, sguardo frontale, respirazione nasale per 90 secondi.', dur:90},
      {instr:'VERITÀ BREVE: scrivi una frase reale che stai evitando di dire ad alta voce.', dur:60},
      {instr:'SELF-COMPASSION RESET: formula 3 frasi come parleresti a un amico che stimi.', dur:120},
      {instr:'MICRO-EXPOSURE: invia un messaggio o pubblica un contenuto che di solito nasconderesti.', dur:180},
    ],
    rewards:[{stat:'CHA',xp:130},{stat:'WIL',xp:100},{stat:'EMP',xp:80}],
  },
  {
    id:'PANIC_HYDRA', name:'Panic Hydra', title:'L’Idra del Panico',
    desc:'Ogni pensiero catastrofico tagliato ne genera due nuovi se il respiro cede.',
    emotionLabel:'PANICO / CATASTROFE', themeClass:'panic', quote:'Il panico vuole velocità. Tu vinci con ritmo.', titleReward:'Pulse Master',
    maxHP:220, level:6, icon:'🐍',
    req:[{stat:'CO2',minLv:7},{stat:'VAG',minLv:7},{stat:'FOC',minLv:5}],
    protocol:[
      {instr:'EXHALE LADDER: espira per 6s, 7s, 8s, 9s, 10s. Un ciclo completo.', dur:150},
      {instr:'COUNT & TOUCH: conta 30 tocchi alternati sulle dita senza accelerare.', dur:90},
      {instr:'VISUAL LOCK: fissa un punto e descrivilo in 5 dettagli precisi.', dur:60},
      {instr:'WALK THE SURGE: cammina lentamente per 3 minuti tenendo le spalle basse.', dur:180},
    ],
    rewards:[{stat:'CO2',xp:140},{stat:'VAG',xp:110},{stat:'FOC',xp:90}],
  },
  {
    id:'ISOLATION_WEAVER', name:'Isolation Weaver', title:'Il Tessitore dell’Isolamento',
    desc:'Intreccia distanze emotive finché ogni aiuto sembra un rischio.',
    emotionLabel:'ISOLAMENTO / DISTACCO', themeClass:'isolation', quote:'Chiedere connessione non è debolezza. È strategia di sopravvivenza.', titleReward:'Signal Caller',
    maxHP:235, level:7, icon:'🕸️',
    req:[{stat:'EMP',minLv:7},{stat:'CHA',minLv:6},{stat:'VAG',minLv:6}],
    protocol:[
      {instr:'SCAN RELAZIONALE: nomina 3 persone sicure con cui puoi riallacciare il contatto.', dur:90},
      {instr:'OUTBOUND ACTION: invia un messaggio autentico, non logistico, a una di loro.', dur:120},
      {instr:'VOICE CONTACT: registra o fai una nota vocale di 60 secondi invece di nasconderti nel testo.', dur:90},
      {instr:'PRESENZA SOCIALE: resta 5 minuti pienamente presente in una conversazione senza multitasking.', dur:300},
    ],
    rewards:[{stat:'EMP',xp:145},{stat:'CHA',xp:105},{stat:'VAG',xp:80}],
  },
  {
    id:'PERFECTION_JUDGE', name:'Perfection Judge', title:'Il Giudice della Perfezione',
    desc:'Condanna ogni bozza incompleta e trasforma il potenziale in stallo eterno.',
    emotionLabel:'CONTROLLO / PERFEZIONISMO', themeClass:'perfectionism', quote:'Fatto batte perfetto. Sempre.', titleReward:'First Draft King',
    maxHP:250, level:8, icon:'⚖️',
    req:[{stat:'DIS',minLv:7},{stat:'INT',minLv:7},{stat:'FOC',minLv:7}],
    protocol:[
      {instr:'UGLY VERSION: produci una bozza deliberatamente imperfetta in 5 minuti.', dur:300},
      {instr:'LIMITAZIONE VOLONTARIA: imponi una sola revisione massima.', dur:60},
      {instr:'SHIP MODE: pubblica, invia o salva come completata la versione disponibile.', dur:120},
      {instr:'POST-MORTEM BREVE: annota una cosa migliorabile senza riaprire il task.', dur:60},
    ],
    rewards:[{stat:'DIS',xp:150},{stat:'INT',xp:110},{stat:'FOC',xp:100}],
  },
  {
    id:'ENVY_CHIMERA', name:'Envy Chimera', title:'La Chimera dell’Invidia',
    desc:'Ti costringe a confrontarti con build altrui finché dimentichi la tua.',
    emotionLabel:'CONFRONTO / IDENTITÀ', themeClass:'envy', quote:'Il confronto serve solo se ti riporta al tuo asse.', titleReward:'Pathkeeper',
    maxHP:270, level:9, icon:'🦚',
    req:[{stat:'ADA',minLv:7},{stat:'WIL',minLv:7},{stat:'INT',minLv:6}],
    protocol:[
      {instr:'SOCIAL FAST: chiudi feed, ranking e notifiche per 10 minuti reali.', dur:600},
      {instr:'SELF-ANCHOR: scrivi 3 metriche con cui vuoi misurare solo te stesso.', dur:120},
      {instr:'ENVY TRANSMUTE: trasforma un confronto in un’azione concreta da eseguire oggi.', dur:120},
      {instr:'RETURN TO BUILD: completa un micro-step sul tuo progetto o corpo entro 3 minuti.', dur:180},
    ],
    rewards:[{stat:'ADA',xp:155},{stat:'WIL',xp:110},{stat:'INT',xp:90}],
  },
];

const BOSS_ACTION_FRAMEWORK = {
  ANXIETY_WRAITH: {
    trigger: 'Si attiva quando interpreti l’attivazione fisica come pericolo imminente e inizi a inseguire scenari peggiori del reale.',
    signs: {
      body: ['Tensione al petto o gola', 'Respiro corto e alto', 'Urgenza di scappare o controllare tutto'],
      thoughts: ['"Sta per succedere qualcosa"', '"Devo calmarmi subito o crollo"', '"Se sento questo, significa pericolo"'],
      behavior: ['Controlli ripetuti', 'Evitamento preventivo', 'Richiesta continua di rassicurazione'],
    },
    fastProtocol: ['Allunga subito l’espirazione.', 'Aggancia 5 dettagli reali nell’ambiente.', 'Nomina l’attivazione senza chiamarla minaccia.'],
    extendedProtocolIntro: 'Esegui il protocollo completo per frenare il loop allarme → interpretazione → escalation.',
    victoryCondition: 'Completa tutti gli step senza interrompere il ritmo e chiudi con respiro più lento, spalle più basse e ritorno a una decisione concreta.',
    factionId: 'NEURAL',
    repGain: 18,
  },
  LETHARGY_GOLEM: {
    trigger: 'Si attiva quando energia bassa, inerzia e assenza di slancio ti fanno trattare l’immobilità come stato normale.',
    signs: {
      body: ['Pesantezza diffusa', 'Lentezza motoria', 'Voglia di stare fermo anche dopo il riposo'],
      thoughts: ['"Lo faccio dopo"', '"Non ho abbastanza energia per partire"', '"Prima devo sentirmi pronto"'],
      behavior: ['Ritardo dell’inizio', 'Scroll passivo', 'Accumulo di compiti piccoli mai avviati'],
    },
    fastProtocol: ['Attiva il corpo con uno shock breve.', 'Fai un micro-set di movimento senza pensarci.', 'Lancia un task da 2 minuti immediatamente.'],
    extendedProtocolIntro: 'Il protocollo esteso serve a riaccendere output e attenzione senza aspettare motivazione spontanea.',
    victoryCondition: 'Passi da immobilità a movimento reale e completi almeno una micro-azione operativa nello stesso ciclo.',
    factionId: 'PHYSIQUE',
    repGain: 20,
  },
  PROCRASTINATION_LEECH: {
    trigger: 'Si attiva quando il task ha attrito iniziale alto e il sistema cerca gratificazione immediata invece di ingresso rapido.',
    signs: {
      body: ['Agitazione bassa ma costante', 'Stanchezza selettiva solo verso il task', 'Picchi di tensione appena provi a iniziare'],
      thoughts: ['"Prima sistemo altro"', '"Mi serve il mood giusto"', '"Inizio dopo un’altra cosa veloce"'],
      behavior: ['Task switching', 'Preparazione infinita', 'Distrazioni progettate per sembrare utili'],
    },
    fastProtocol: ['Riduci il task a 2 minuti.', 'Taglia tre distrazioni fisiche.', 'Comunica a qualcuno cosa inizi adesso.'],
    extendedProtocolIntro: 'Questo boss cade quando abbassi l’attrito iniziale e rendi pubblica la direzione del task.',
    victoryCondition: 'Entri davvero nel compito evitato, superi il primo minuto e lasci una prova concreta di avanzamento.',
    factionId: 'COGNITIVE',
    repGain: 22,
  },
  ANGER_BERSERKER: {
    trigger: 'Si attiva quando frustrazione, minaccia o percezione di ingiustizia spingono l’energia verso scarica impulsiva.',
    signs: {
      body: ['Calore, mandibola dura, pugni tesi', 'Accelerazione improvvisa del respiro', 'Impulso a muoverti o parlare troppo forte'],
      thoughts: ['"Devo reagire subito"', '"Non posso lasciar correre"', '"Se non esplodo, perdo"'],
      behavior: ['Messaggi impulsivi', 'Tono aggressivo', 'Escalation relazionale rapida'],
    },
    fastProtocol: ['Scarica CO2 con sigh controllati.', 'Sposta il punto di vista in terza persona.', 'Ritarda qualsiasi risposta offensiva.'],
    extendedProtocolIntro: 'Il protocollo esteso converte impulso in controllo e ti fa tornare da reazione a strategia.',
    victoryCondition: 'Rallenti il corpo, abbassi il tono della risposta e trasformi la scarica in un’azione disciplinata invece che distruttiva.',
    factionId: 'SOCIAL',
    repGain: 26,
  },
  DESPAIR_PHANTOM: {
    trigger: 'Si attiva quando il sistema perde senso, l’azione sembra inutile e ogni sforzo viene percepito come vuoto.',
    signs: {
      body: ['Peso generalizzato', 'Postura chiusa', 'Riduzione netta della spinta motoria'],
      thoughts: ['"Non serve a niente"', '"Tanto non cambia nulla"', '"Non ho motivo per muovermi"'],
      behavior: ['Ritiro', 'Blocco delle iniziative', 'Taglio del contatto umano e dei rituali base'],
    },
    fastProtocol: ['Muovi il corpo all’aperto.', 'Riattacca a un valore concreto.', 'Cerca una connessione umana immediata.'],
    extendedProtocolIntro: 'Qui non cerchi ispirazione: ripristini ritmo, valore e contatto finché il vuoto perde dominio.',
    victoryCondition: 'Completi il protocollo e chiudi con un atto reale di movimento, contatto o senso che rompe la paralisi.',
    factionId: 'NEURAL',
    repGain: 30,
  },
  SHAME_SIREN: {
    trigger: 'Si attiva quando rischio di esposizione, giudizio o imperfezione ti spinge a sparire prima di essere visto davvero.',
    signs: {
      body: ['Postura che collassa', 'Sguardo evitante', 'Nodo allo stomaco o al volto'],
      thoughts: ['"Farò una figuraccia"', '"Meglio non farmi notare"', '"Se mostro questo, perdo valore"'],
      behavior: ['Auto-censura', 'Silenzio difensivo', 'Ritiro poco prima dell’azione sociale'],
    },
    fastProtocol: ['Riapri la postura.', 'Dì una verità breve ad alta voce.', 'Fai una micro-esposizione subito.'],
    extendedProtocolIntro: 'Questo protocollo allena visibilità tollerabile: non perfetta, ma abbastanza reale da rompere la vergogna.',
    victoryCondition: 'Ti esponi in modo misurabile senza ritirarti e chiudi il loop con un’azione visibile, inviata o pubblicata.',
    factionId: 'SOCIAL',
    repGain: 32,
  },
  PANIC_HYDRA: {
    trigger: 'Si attiva quando la velocità interna supera il controllo e ogni picco di attivazione genera nuova catastrofe mentale.',
    signs: {
      body: ['Picco di battito e respiro', 'Vertigine o tremore', 'Sensazione di perdita di controllo imminente'],
      thoughts: ['"Sto per esplodere"', '"Peggiora troppo in fretta"', '"Devo fermarlo subito"'],
      behavior: ['Iper-monitoraggio', 'Fuga', 'Tentativi caotici di spegnere tutto'],
    },
    fastProtocol: ['Rallenta il respiro con espirazioni a scalare.', 'Ancora attenzione a un punto preciso.', 'Cammina lento invece di combattere la scarica.'],
    extendedProtocolIntro: 'L’Idra perde potere quando scegli ritmo e precisione invece di velocità e lotta interna.',
    victoryCondition: 'Porti il corpo fuori dal picco senza accelerare, completi tutti gli step e torni a un ritmo sostenibile.',
    factionId: 'NEURAL',
    repGain: 34,
  },
  ISOLATION_WEAVER: {
    trigger: 'Si attiva quando vulnerabilità o fatica ti convincono che contattare qualcuno sia più pericoloso che restare solo.',
    signs: {
      body: ['Chiusura del petto', 'Svuotamento della voce', 'Energia sociale che crolla in anticipo'],
      thoughts: ['"Meglio non disturbare"', '"Nessuno capirebbe davvero"', '"È più sicuro stare offline"'],
      behavior: ['Ghosting', 'Risposte minime', 'Evitamento di contatto autentico'],
    },
    fastProtocol: ['Nomina tre persone sicure.', 'Manda un messaggio reale, non logistico.', 'Scegli la voce invece del solo testo.'],
    extendedProtocolIntro: 'Questo protocollo ricostruisce connessione come atto tattico, non come dipendenza o debolezza.',
    victoryCondition: 'Crei contatto autentico e resti presente abbastanza a lungo da interrompere l’isolamento difensivo.',
    factionId: 'SOCIAL',
    repGain: 36,
  },
  PERFECTION_JUDGE: {
    trigger: 'Si attiva quando il compito richiede output visibile e il controllo totale diventa più importante della chiusura reale.',
    signs: {
      body: ['Tensione fine e rigida', 'Fatica mentale da revisione continua', 'Blocco davanti alla consegna'],
      thoughts: ['"Non è ancora pronto"', '"Serve un altro giro"', '"Se non è perfetto, non vale"'],
      behavior: ['Revisione infinita', 'Mancata consegna', 'Bozze che non lasciano mai il desktop'],
    },
    fastProtocol: ['Produci una brutta prima versione.', 'Imponi un solo passaggio di revisione.', 'Consegna o chiudi il task appena è sufficiente.'],
    extendedProtocolIntro: 'Il Giudice cade quando sostituisci perfezione con completamento misurabile e ritmi di rilascio reali.',
    victoryCondition: 'Chiudi e spedisci una versione utilizzabile senza riaprire il task per perfezionismo compulsivo.',
    factionId: 'COGNITIVE',
    repGain: 38,
  },
  ENVY_CHIMERA: {
    trigger: 'Si attiva quando il confronto con le build altrui ti disallinea dal tuo asse e trasforma ispirazione in perdita di identità.',
    signs: {
      body: ['Attivazione dispersa', 'Irrequietezza dopo social o ranking', 'Fatica a restare nel tuo compito'],
      thoughts: ['"Loro sono più avanti"', '"Sto sbagliando strada"', '"Forse dovrei cambiare tutto"'],
      behavior: ['Doom-scrolling comparativo', 'Cambio piano continuo', 'Abbandono della tua road map'],
    },
    fastProtocol: ['Taglia feed e ranking per una finestra breve.', 'Scrivi tre metriche solo tue.', 'Converti il confronto in una singola azione sul tuo path.'],
    extendedProtocolIntro: 'La Chimera muore quando il confronto smette di guidare il timone e torna a nutrire solo decisioni utili.',
    victoryCondition: 'Rientri nella tua build, definisci metriche interne e completi un passo concreto sul tuo percorso nello stesso blocco.',
    factionId: 'COGNITIVE',
    repGain: 40,
  },
};

const BOSS_CAMPAIGN_EFFECTS = {
  ANXIETY_WRAITH: [
    {
      targetId: 'PANIC_HYDRA',
      type: 'weakness',
      title: 'Weakness Revealed',
      summary: 'L’Idra perde potere quando accetti il picco iniziale invece di inseguire lo spegnimento immediato.',
      why: 'Dopo aver spezzato Anxiety Wraith riconosci piu in fretta il falso allarme che alimenta il panico.',
      weaknessReveal: 'Non va domata con velocita: si apre quando rallenti l’espirazione e smetti di trattare il picco come prova di collasso.',
      damageBonus: 0.12,
    },
    {
      targetId: 'SHAME_SIREN',
      type: 'protocol',
      title: 'Alternative Protocol Step',
      summary: 'Si sblocca un ingresso piu rapido basato su naming e reality check invece che solo esposizione diretta.',
      why: 'Aver vinto contro l’ansia ti insegna a distinguere attivazione da giudizio reale.',
      protocolStep: {
        insertAfter: 1,
        label: 'Signal Naming',
        instr: 'Nomina ad alta voce il segnale fisico e separalo dal giudizio: "Sto sentendo attivazione, non una sentenza sul mio valore".',
        dur: 75,
      },
      fastProtocolAdd: 'Nomina il segnale prima di interpretarlo come condanna.',
    },
  ],
  LETHARGY_GOLEM: [
    {
      targetId: 'DESPAIR_PHANTOM',
      type: 'advantage',
      title: 'Tactical Advantage',
      summary: 'Entri nello scontro con un prime motorio gia attivo.',
      why: 'Il Golem della Letargia ti insegna a forzare il primo movimento anche quando il sistema vuole collassare.',
      advantage: 'Apertura piu facile: i timer del protocollo si accorciano e il primo passo costa meno attrito.',
      durationMult: 0.88,
      bonusRewards: [{ materialId: 'BOSS_CORE', amount: 1 }],
    },
  ],
  PROCRASTINATION_LEECH: [
    {
      targetId: 'PERFECTION_JUDGE',
      type: 'protocol',
      title: 'Alternative Protocol Step',
      summary: 'Sblocchi una branch che forza la consegna di un frammento prima della revisione.',
      why: 'Aver rotto la procrastinazione rende piu facile entrare nel loop "ship first, refine later".',
      protocolStep: {
        insertAfter: 0,
        label: 'First Fragment',
        instr: 'Pubblica o invia un frammento incompleto entro 90 secondi prima di qualsiasi rifinitura.',
        dur: 90,
      },
      advantage: 'Riduce l’attrito iniziale del fight e accelera l’ingresso nella consegna.',
      damageBonus: 0.14,
    },
  ],
  ANGER_BERSERKER: [
    {
      targetId: 'ISOLATION_WEAVER',
      type: 'weakness',
      title: 'Weakness Revealed',
      summary: 'Il Tessitore si incrina quando rallenti abbastanza da non usare il ritiro come autodifesa aggressiva.',
      why: 'Controllare la rabbia rende visibile la differenza tra proteggerti e tagliare il contatto.',
      weaknessReveal: 'La sua debolezza e la presenza regolata: voce bassa, contatto breve ma vero, zero multitasking difensivo.',
      durationMult: 0.92,
    },
  ],
  DESPAIR_PHANTOM: [
    {
      targetId: 'ISOLATION_WEAVER',
      type: 'reward',
      title: 'Campaign Reward Cache',
      summary: 'Le prossime vittorie contro l’isolamento rilasciano materiali extra e piu contesto tattico.',
      why: 'Quando rompi la disperazione, i fight sociali smettono di sembrare puro rischio e iniziano a dare ritorni migliori.',
      bonusRewards: [{ materialId: 'BOSS_CORE', amount: 1 }],
      rewardUnlock: 'Cache di campagna: +1 BOSS CORE al clear.',
    },
  ],
  SHAME_SIREN: [
    {
      targetId: 'ENVY_CHIMERA',
      type: 'weakness',
      title: 'Weakness Revealed',
      summary: 'La Chimera perde presa se arrivi con identita dichiarata invece che in cerca di validazione esterna.',
      why: 'Dopo la Siren della Vergogna ti esponi con piu stabilita e il confronto perde veleno.',
      weaknessReveal: 'Va colpita con metriche interne, non con ranking esterni.',
      damageBonus: 0.1,
      rewardUnlock: 'Frammento identitario: chance bonus di materiale al clear.',
      bonusRewards: [{ materialId: 'BOSS_CORE', amount: 1 }],
    },
  ],
  PANIC_HYDRA: [
    {
      targetId: 'ENVY_CHIMERA',
      type: 'advantage',
      title: 'Tactical Advantage',
      summary: 'Con piu controllo del ritmo interno, il confronto non riesce piu a trascinarti fuori asse cosi facilmente.',
      why: 'Dopo Panic Hydra hai piu margine per restare sul tuo ritmo invece di reagire alla velocita altrui.',
      advantage: 'Riduzione difficolta: il danno inflitto per step aumenta e il fight diventa piu lineare.',
      damageBonus: 0.12,
    },
  ],
  ISOLATION_WEAVER: [
    {
      targetId: 'ENVY_CHIMERA',
      type: 'protocol',
      title: 'Alternative Protocol Step',
      summary: 'Sblocchi un passo di reality anchoring con una voce alleata o una nota audio a te stesso.',
      why: 'Quando riapri il canale sociale, il confronto smette di essere un monologo tossico.',
      protocolStep: {
        insertAfter: 2,
        label: 'Ally Anchor',
        instr: 'Invia o riascolta una nota vocale di 30-60 secondi che ti riporta alla tua road map reale.',
        dur: 60,
      },
      fastProtocolAdd: 'Richiama una voce alleata prima di riaprire feed e ranking.',
    },
  ],
};

// ========================
// WEEKLY QUESTS
// ========================

const WEEKLY_QUESTS = [
  {
    id:'w_iron_mind', name:'The Iron Mind', desc:'Meditazione + Cold Exposure + Deep Work in un solo giorno.',
    type:'WEEKLY', cat:'COGNITIVE', diff:9, dur:135, req:[{stat:'WIL',minLv:5},{stat:'FOC',minLv:4}],
    rewards:[{stat:'WIL',xp:120},{stat:'FOC',xp:100},{stat:'DIS',xp:80}],
    protocol:['Completa Mindfulness Protocol','Completa Protocollo Cold Exposure','Completa Deep Work Dungeon'],
    science:'La sequenza meditazione→cold→deep work sfrutta l\'attivazione noradrenergica sequenziale.', icon:'🧊',
    subQuests:['meditation','cold_exposure','deep_work']
  },
  {
    id:'w_full_spectrum', name:'Full Spectrum Dominance', desc:'Completa almeno 1 quest per ogni categoria in un giorno.',
    type:'WEEKLY', cat:'NEURAL', diff:9, dur:180, req:[{stat:'ADA',minLv:3}],
    rewards:[{stat:'ADA',xp:100},{stat:'VIT',xp:80},{stat:'RSL',xp:60}],
    protocol:['Completa 1 quest PHYSIQUE','Completa 1 quest COGNITIVE','Completa 1 quest NEURAL','Completa 1 quest SOCIAL'],
    science:'L\'attivazione multi-dominio potenzia la connettività inter-emisferica.', icon:'🌈',
    subQuests:[]
  },
  {
    id:'w_warrior_trial', name:'Warrior\'s Trial', desc:'Vestibolare + Forza + HIIT in un solo giorno.',
    type:'WEEKLY', cat:'PHYSIQUE', diff:10, dur:90, req:[{stat:'STR',minLv:5},{stat:'RES',minLv:4}],
    rewards:[{stat:'STR',xp:130},{stat:'RES',xp:110},{stat:'VIT',xp:90}],
    protocol:['Completa Vestibular Calibration','Completa Protocollo Forza Neurale','Completa HIIT Neural Boost'],
    science:'L\'allenamento multi-modale massimizza il rilascio di HGH e testosterone.', icon:'⚔️',
    subQuests:['vestibular','strength','cardio_hiit']
  },
  {
    id:'w_social_siege', name:'Social Siege', desc:'Completa Social Calibration + Box Breathing + Vagal Reset oggi.',
    type:'WEEKLY', cat:'SOCIAL', diff:8, dur:48, req:[{stat:'CHA',minLv:4}],
    rewards:[{stat:'CHA',xp:110},{stat:'EMP',xp:90},{stat:'LEA',xp:70}],
    protocol:['Completa Box Breathing Protocol','Completa Vagal Reset','Completa Social Calibration'],
    science:'La preparazione vagale prima dell\'esposizione sociale riduce l\'amigdala reattiva.', icon:'👥',
    subQuests:['box_breathing','vagal_reset','social_exposure']
  },
];

// ========================
// QUEST CHAINS
// ========================

const CHAIN_DEFINITIONS = [
  {
    id:'chain_breath', name:'Via del Respiro', desc:'Padroneggia il respiro in 3 fasi.',
    icon:'🌬️', steps:[
      {questId:'box_breathing', name:'Fase 1: Fondamenta', desc:'Stabilizza il pattern respiratorio.'},
      {questId:'vagal_reset', name:'Fase 2: Attivazione Vagale', desc:'Stimola il nervo vago con il respiro.'},
      {questId:'cold_exposure', name:'Fase 3: Prova del Freddo', desc:'Mantieni il controllo sotto stress da freddo.'},
    ],
    completionRewards:[{stat:'CO2',xp:150},{stat:'VAG',xp:150}],
    completionBuff:'BREATH_MASTER',
  },
  {
    id:'chain_neural', name:'Risveglio Neurale', desc:'Attiva tutti i domini cognitivi.',
    icon:'🧠', steps:[
      {questId:'meditation', name:'Fase 1: Silenzio', desc:'Acquieta la mente.'},
      {questId:'deep_work', name:'Fase 2: Focus Totale', desc:'Canalizza l\'attenzione.'},
      {questId:'creative_block', name:'Fase 3: Esplosione Creativa', desc:'Libera il pensiero divergente.'},
    ],
    completionRewards:[{stat:'INT',xp:150},{stat:'FOC',xp:120},{stat:'CRE',xp:100}],
    completionBuff:'NEURAL_SURGE',
  },
  {
    id:'chain_warrior', name:'Prova del Guerriero', desc:'Tempra il corpo in 3 sfide.',
    icon:'⚔️', steps:[
      {questId:'vestibular', name:'Fase 1: Equilibrio', desc:'Calibra il sistema vestibolare.'},
      {questId:'strength', name:'Fase 2: Potenza', desc:'Spingi i limiti della forza.'},
      {questId:'cardio_hiit', name:'Fase 3: Resistenza', desc:'Supera la soglia cardiovascolare.'},
    ],
    completionRewards:[{stat:'STR',xp:150},{stat:'RES',xp:120},{stat:'AGI',xp:100}],
    completionBuff:'IRON_BODY',
  },
  {
    id:'chain_shadow', name:'Via dell\'Ombra', desc:'Conquista il dominio emotivo.',
    icon:'🌑', steps:[
      {questId:'vagal_reset', name:'Fase 1: Calma', desc:'Ripristina l\'equilibrio del SNA.'},
      {questId:'meditation', name:'Fase 2: Osservazione', desc:'Osserva senza reagire.'},
      {questId:'social_exposure', name:'Fase 3: Esposizione', desc:'Affronta il mondo con calma interiore.'},
    ],
    completionRewards:[{stat:'WIL',xp:150},{stat:'VAG',xp:120},{stat:'CHA',xp:100}],
    completionBuff:'SHADOW_CLOAK',
  },
];

// ========================
// COMBOS
// ========================

const COMBO_DEFINITIONS = [
  {
    id:'mind_body', name:'MIND-BODY LINK', desc:'1 PHYSIQUE + 1 COGNITIVE', icon:'🔗',
    check: (done) => {
      const cats = done.map(id => findQuestById(id)?.cat).filter(Boolean);
      return cats.includes('PHYSIQUE') && cats.includes('COGNITIVE');
    }, bonusXP:50, bonusStat:'ADA',
  },
  {
    id:'full_spectrum', name:'FULL SPECTRUM', desc:'1 per ogni categoria', icon:'🌈',
    check: (done) => {
      const cats = new Set(done.map(id => findQuestById(id)?.cat).filter(Boolean));
      return cats.has('PHYSIQUE') && cats.has('COGNITIVE') && cats.has('NEURAL') && cats.has('SOCIAL');
    }, bonusXP:100, bonusStat:'VIT',
  },
  {
    id:'iron_will', name:'VOLONTÀ DI FERRO', desc:'3+ quest diff ≥ 6', icon:'🔥',
    check: (done) => done.filter(id => (findQuestById(id)?.diff??0) >= 6).length >= 3,
    bonusXP:80, bonusStat:'WIL',
  },
  {
    id:'recovery_master', name:'RECUPERO TOTALE', desc:'2+ quest recovery/facili', icon:'💚',
    check: (done) => done.filter(id => { const q=findQuestById(id); return q&&(q.type==='RECOVERY'||q.diff<=3); }).length >= 2,
    bonusXP:40, bonusStat:'VAG',
  },
  {
    id:'social_butterfly', name:'FARFALLA SOCIALE', desc:'2+ quest SOCIAL', icon:'🦋',
    check: (done) => done.filter(id => findQuestById(id)?.cat==='SOCIAL').length >= 2,
    bonusXP:60, bonusStat:'CHA',
  },
];

// ========================
// ACHIEVEMENTS
// ========================

const ACHIEVEMENT_DEFINITIONS = [
  { id:'first_blood',  name:'FIRST BLOOD',     icon:'🩸', desc:'Completa la prima quest.',    check:s=>s.questsCompleted>=1 },
  { id:'dedicated',    name:'IL DEDICATO',      icon:'🔥', desc:'Completa 10 quest.',           check:s=>s.questsCompleted>=10 },
  { id:'centurion',    name:'CENTURION',        icon:'🏛️', desc:'Completa 100 quest.',          check:s=>s.questsCompleted>=100 },
  { id:'legend',       name:'LEGGENDA',         icon:'⭐', desc:'Completa 500 quest.',          check:s=>s.questsCompleted>=500 },
  { id:'streak_7',     name:'STREAK WARRIOR',   icon:'🔗', desc:'Streak di 7 giorni.',          check:s=>s.currentStreak>=7 },
  { id:'streak_30',    name:'STREAK LEGEND',    icon:'⛓️', desc:'Streak di 30 giorni.',         check:s=>s.currentStreak>=30 },
  { id:'streak_100',   name:'UNSTOPPABLE',      icon:'💎', desc:'Streak di 100 giorni.',        check:s=>s.currentStreak>=100 },
  { id:'boss_slayer',  name:'BOSS SLAYER',      icon:'💀', desc:'Sconfiggi il primo boss.',     check:s=>s.bossesDefeated.length>=1 },
  { id:'exterminator', name:'EXTERMINATOR',      icon:'☠️', desc:'Sconfiggi tutti i boss.',      check:s=>s.bossesDefeated.length>=BOSS_DEFINITIONS.length },
  { id:'combo_first',  name:'COMBO STARTER',    icon:'🔗', desc:'Attiva la prima combo.',       check:s=>(s.totalCombos||0)>=1 },
  { id:'combo_king',   name:'COMBO KING',       icon:'👑', desc:'Attiva 25 combo.',             check:s=>(s.totalCombos||0)>=25 },
  { id:'chain_first',  name:'CHAIN MASTER',     icon:'⛓️', desc:'Completa una catena.',          check:s=>Object.values(s.chainProgress||{}).some(c=>c.completed) },
  { id:'class_10',     name:'CLASS ASCENSION',  icon:'🌟', desc:'Class Sync 10.',               check:s=>getClassLevel()>=10 },
  { id:'lv_30',        name:'SHADOW ADEPT',     icon:'🌑', desc:'Hunter Rank 30+.',             check:s=>getTotalLevel()>=30 },
  { id:'lv_60',        name:'MONARCH',          icon:'👁', desc:'Hunter Rank 60+.',             check:s=>getTotalLevel()>=60 },
  { id:'crit_10',      name:'LUCKY STRIKER',    icon:'⚡', desc:'10 colpi critici.',            check:s=>(s.criticalHits||0)>=10 },
  { id:'xp_10k',       name:'XP HARVESTER',     icon:'💰', desc:'Accumula 10.000 XP.',          check:s=>s.totalXP>=10000 },
  { id:'xp_100k',      name:'XP OVERLORD',      icon:'💎', desc:'Accumula 100.000 XP.',         check:s=>s.totalXP>=100000 },
];

// ========================
// BUFF CATALOG
// ========================

const BUFF_CATALOG = {
  XP_CRYSTAL:    { name:'XP Crystal',      icon:'💎', desc:'+25% XP per 3 quest', durType:'quest', dur:3, effect:'xpMult', value:1.25 },
  FOCUS_SHARD:   { name:'Focus Shard',     icon:'🎯', desc:'+30 XP FOC per 24h',  durType:'time', dur:86400000, effect:'bonusStat', stat:'FOC', value:30 },
  IRON_HEART:    { name:'Iron Heart',      icon:'❤️', desc:'+30 XP VIT per 24h',  durType:'time', dur:86400000, effect:'bonusStat', stat:'VIT', value:30 },
  LUCKY_CHARM:   { name:'Lucky Charm',     icon:'🍀', desc:'2x chance crit 24h',  durType:'time', dur:86400000, effect:'critBoost', value:2 },
  BREATH_MASTER: { name:'Respiro Supremo', icon:'🌬️', desc:'+50 XP CO2/VAG 24h', durType:'time', dur:86400000, effect:'bonusMulti', stats:['CO2','VAG'], value:50 },
  NEURAL_SURGE:  { name:'Scarica Neurale', icon:'⚡', desc:'+50 XP INT/FOC 24h', durType:'time', dur:86400000, effect:'bonusMulti', stats:['INT','FOC'], value:50 },
  IRON_BODY:     { name:'Corpo d\'Acciaio',icon:'🛡️', desc:'+50 XP STR/RES 24h', durType:'time', dur:86400000, effect:'bonusMulti', stats:['STR','RES'], value:50 },
  SHADOW_CLOAK:  { name:'Manto d\'Ombra', icon:'🌑', desc:'+50 XP WIL/CHA 24h', durType:'time', dur:86400000, effect:'bonusMulti', stats:['WIL','CHA'], value:50 },
  STAT_CRYSTAL:  { name:'Cristallo Stat',  icon:'✨', desc:'+15 XP stat random',  durType:'instant', effect:'instantXP', value:15 },
};

const EQUIPMENT_SLOTS = [
  'WEAPON_MAIN',
  'HELMET',
  'WEAPON_OFF',
  'AMULET',
  'RING_LEFT',
  'BODY',
  'RING_RIGHT',
  'GLOVES',
  'BELT',
  'BOOTS',
  'FLASK_ONE',
  'FLASK_TWO',
];

const EQUIPMENT_SLOT_LABELS = {
  WEAPON_MAIN: 'WEAPON I',
  HELMET: 'HELMET',
  WEAPON_OFF: 'WEAPON II',
  AMULET: 'AMULET',
  RING_LEFT: 'RING I',
  BODY: 'BODY ARMOUR',
  RING_RIGHT: 'RING II',
  GLOVES: 'GLOVES',
  BELT: 'BELT',
  BOOTS: 'BOOTS',
  FLASK_ONE: 'FLASK I',
  FLASK_TWO: 'FLASK II',
};

const EQUIPMENT_SET_BONUSES = {
  SHADOWFORGED: {
    name: 'Shadowforged Hunt',
    icon: '🌑',
    thresholds: {
      2: { AGI: 1, FOC: 1 },
      4: { WIL: 1 },
    },
  },
  MONARCH_SYNTH: {
    name: 'Monarch Synthesis',
    icon: '👁',
    thresholds: {
      2: { INT: 1, CHA: 1 },
      4: { FOC: 1, EMP: 1 },
    },
  },
  IRON_HEART: {
    name: 'Iron Heart Frame',
    icon: '🛡️',
    thresholds: {
      2: { RES: 1, VIT: 1 },
      4: { STR: 1, VAG: 1 },
    },
  },
};

function createEmptyGearSlots() {
  return Object.fromEntries(EQUIPMENT_SLOTS.map(slot => [slot, null]));
}

const EQUIPMENT_CATALOG = {
  SHADOW_RECURVE: {
    id: 'SHADOW_RECURVE', slot: 'WEAPON_MAIN', set: 'SHADOWFORGED', name: 'Shadow Recurve', icon: '🏹', rarity: 'EPIC',
    desc: 'Arco da caccia neurale. Trasforma attenzione e timing in esecuzione pulita.', bonuses: { AGI: 2, WIL: 1 },
  },
  QUIVER_ZERO: {
    id: 'QUIVER_ZERO', slot: 'WEAPON_OFF', set: 'SHADOWFORGED', name: 'Quiver Zero', icon: '🪶', rarity: 'RARE',
    desc: 'Faretra tattica con assetto minimal. Riduce attrito cognitivo e migliora precisione.', bonuses: { FOC: 1, AGI: 1, DIS: 1 },
  },
  MONARCH_HELM: {
    id: 'MONARCH_HELM', slot: 'HELMET', set: 'MONARCH_SYNTH', name: 'Monarch Helm', icon: '👑', rarity: 'LEGENDARY',
    desc: 'Interfaccia da comando che amplifica lettura di pattern e decisione fredda.', bonuses: { INT: 2, FOC: 1 },
  },
  VAGAL_AMULET: {
    id: 'VAGAL_AMULET', slot: 'AMULET', set: 'MONARCH_SYNTH', name: 'Vagal Amulet', icon: '📿', rarity: 'EPIC',
    desc: 'Amuleto di recovery che stabilizza il sistema prima di un fight mentale.', bonuses: { VAG: 2, EMP: 1 },
  },
  LUCID_RING_ALPHA: {
    id: 'LUCID_RING_ALPHA', slot: 'RING_LEFT', set: 'MONARCH_SYNTH', name: 'Lucid Ring Alpha', icon: '💍', rarity: 'RARE',
    desc: 'Anello per compressione del rumore mentale. Utile nei dungeon cognitivi.', bonuses: { INT: 1, CHA: 1 },
  },
  CO2_LOOP: {
    id: 'CO2_LOOP', slot: 'RING_RIGHT', set: 'MONARCH_SYNTH', name: 'CO2 Loop', icon: '🫧', rarity: 'RARE',
    desc: 'Circuito per addestrare la calma sotto pressione respiratoria.', bonuses: { CO2: 2, VAG: 1 },
  },
  IRON_HEART_CUIRASS: {
    id: 'IRON_HEART_CUIRASS', slot: 'BODY', set: 'IRON_HEART', name: 'Iron Heart Cuirass', icon: '🦺', rarity: 'EPIC',
    desc: 'Corazza per tenuta strutturale, postura e resilienza sotto carico.', bonuses: { RES: 2, STR: 2 },
  },
  GRIP_PROTOCOL: {
    id: 'GRIP_PROTOCOL', slot: 'GLOVES', set: 'SHADOWFORGED', name: 'Grip Protocol Gloves', icon: '🧤', rarity: 'RARE',
    desc: 'Guanti da esecuzione fine: mani calme, output veloce, minore dispersione.', bonuses: { FOC: 1, AGI: 1, STR: 1 },
  },
  CORE_BIND: {
    id: 'CORE_BIND', slot: 'BELT', set: 'IRON_HEART', name: 'Core Bind Belt', icon: '🪢', rarity: 'EPIC',
    desc: 'Cintura di compressione centrale. Migliora brace, volonta e stabilita.', bonuses: { WIL: 1, RES: 1, VIT: 1 },
  },
  STALKER_BOOTS: {
    id: 'STALKER_BOOTS', slot: 'BOOTS', set: 'SHADOWFORGED', name: 'Stalker Boots', icon: '🥾', rarity: 'EPIC',
    desc: 'Stivali per spostamenti puliti e rapidi. Il pavimento diventa un radar.', bonuses: { AGI: 2, ADA: 1 },
  },
  CRIMSON_FLASK: {
    id: 'CRIMSON_FLASK', slot: 'FLASK_ONE', set: 'IRON_HEART', name: 'Crimson Flask', icon: '🧪', rarity: 'RARE',
    desc: 'Flask da recovery rosso. Innalza vitalita operativa e capacity di recupero.', bonuses: { VIT: 2, RES: 1 },
  },
  AZURE_FLASK: {
    id: 'AZURE_FLASK', slot: 'FLASK_TWO', set: 'IRON_HEART', name: 'Azure Flask', icon: '🧴', rarity: 'RARE',
    desc: 'Flask blu da focus e regolazione. Ideale prima dei raid cognitivi.', bonuses: { FOC: 1, VAG: 1, DIS: 1 },
  },
};

const SPECIAL_QUESTS = [
  {
    id:'shadow_recurve_trial', name:'Shadow Recurve Trial', desc:'Raid atletico per sbloccare l\'arco principale della build.',
    type:'SPECIAL', cat:'PHYSIQUE', diff:8, dur:35, req:[{ stat:'AGI', minLv:4 },{ stat:'WIL', minLv:4 }], timed:true,
    rewards:[{ stat:'AGI', xp:70 },{ stat:'WIL', xp:45 }],
    protocol:['5 min warm-up rapido','20 min sprint tecnici o footwork','3 set di precision drill','Log finale: 3 errori, 3 fix'],
    science:'Timing motorio e pressione moderata rinforzano accuratezza e controllo esecutivo.', icon:'🏹', equipmentId:'SHADOW_RECURVE'
  },
  {
    id:'quiver_zero_protocol', name:'Quiver Zero Protocol', desc:'Protocollo di ordine e precisione per la seconda arma tattica.',
    type:'SPECIAL', cat:'COGNITIVE', diff:6, dur:28, req:[{ stat:'FOC', minLv:3 },{ stat:'DIS', minLv:3 }], timed:false,
    rewards:[{ stat:'FOC', xp:55 },{ stat:'DIS', xp:45 }],
    protocol:['Reset del workspace','25 min task singolo senza alt-tab','2 min review sulle distrazioni','Chiudi con checklist minima'],
    science:'Ridurre switching cost abbassa rumore cognitivo e migliora performance sostenuta.', icon:'🪶', equipmentId:'QUIVER_ZERO'
  },
  {
    id:'monarch_helm_scan', name:'Monarch Helm Scan', desc:'Dungeon di deep work per sbloccare il casco da comando.',
    type:'SPECIAL', cat:'COGNITIVE', diff:9, dur:45, req:[{ stat:'INT', minLv:5 },{ stat:'FOC', minLv:4 }], timed:true,
    rewards:[{ stat:'INT', xp:80 },{ stat:'FOC', xp:50 }],
    protocol:['45 min deep work blindato','1 problema difficile risolto','5 pattern estratti','3 decisioni tattiche nette'],
    science:'Il focus prolungato potenzia controllo top-down e pattern recognition.', icon:'👑', equipmentId:'MONARCH_HELM'
  },
  {
    id:'vagal_amulet_recovery', name:'Vagal Amulet Recovery', desc:'Recovery run per ottenere l\'amuleto di regolazione.',
    type:'SPECIAL', cat:'SOCIAL', diff:7, dur:24, req:[{ stat:'VAG', minLv:4 },{ stat:'EMP', minLv:3 }], timed:false,
    rewards:[{ stat:'VAG', xp:65 },{ stat:'EMP', xp:45 }],
    protocol:['6 min box breathing','2 min splash freddo viso','1 contatto umano regolato','2 min journaling sul tono'],
    science:'Respirazione, cold face exposure e co-regolazione migliorano flessibilita autonomica.', icon:'📿', equipmentId:'VAGAL_AMULET'
  },
  {
    id:'lucid_ring_alpha', name:'Lucid Ring Alpha', desc:'Micro-raid sociale per guadagnare un anello di chiarezza.',
    type:'SPECIAL', cat:'SOCIAL', diff:6, dur:20, req:[{ stat:'CHA', minLv:3 },{ stat:'INT', minLv:3 }], timed:false,
    rewards:[{ stat:'CHA', xp:50 },{ stat:'INT', xp:40 }],
    protocol:['Invia un messaggio ad alta chiarezza','Fai una domanda diretta','Evita filler per 10 min','Annota outcome e risposta'],
    science:'La chiarezza espressiva riduce carico sociale e aumenta agency comunicativa.', icon:'💍', equipmentId:'LUCID_RING_ALPHA'
  },
  {
    id:'co2_loop_dive', name:'CO2 Loop Dive', desc:'Sfida respiratoria controllata per il secondo anello.',
    type:'SPECIAL', cat:'NEURAL', diff:7, dur:22, req:[{ stat:'CO2', minLv:4 },{ stat:'VAG', minLv:3 }], timed:false,
    rewards:[{ stat:'CO2', xp:60 },{ stat:'VAG', xp:40 }],
    protocol:['5 round di espirazioni lunghe','2 hold in sicurezza','Camminata nasale 8 min','Annota calma percepita'],
    science:'Allenare la tolleranza alla CO2 migliora controllo autonomico e stabilita soggettiva.', icon:'🫧', equipmentId:'CO2_LOOP'
  },
  {
    id:'iron_heart_forge', name:'Forge of Iron Heart', desc:'Quest pesante per forgiare il body armour principale.',
    type:'SPECIAL', cat:'PHYSIQUE', diff:9, dur:50, req:[{ stat:'STR', minLv:5 },{ stat:'RES', minLv:5 }], timed:true,
    rewards:[{ stat:'STR', xp:85 },{ stat:'RES', xp:55 }],
    protocol:['Circuito forza-resistenza 30 min','Carry o plank finali','5 min nasal cooldown','Log del carico percepito'],
    science:'Le prove miste forza-resistenza aumentano robustezza periferica e tolleranza al carico.', icon:'🦺', equipmentId:'IRON_HEART_CUIRASS'
  },
  {
    id:'grip_protocol_gloves', name:'Grip Protocol Gloves', desc:'Missione fine-motoria per sbloccare i guanti da esecuzione.',
    type:'SPECIAL', cat:'PHYSIQUE', diff:7, dur:26, req:[{ stat:'AGI', minLv:4 },{ stat:'FOC', minLv:3 }], timed:true,
    rewards:[{ stat:'AGI', xp:60 },{ stat:'FOC', xp:45 }],
    protocol:['10 min coordination drill','3 set hand-grip o hang leggero','5 min task di precisione','Review del tremore/controllo'],
    science:'La precisione manuale sotto lieve fatica migliora controllo neuromotorio.', icon:'🧤', equipmentId:'GRIP_PROTOCOL'
  },
  {
    id:'core_bind_belt', name:'Core Bind Belt', desc:'Raid posturale per cintura e stabilita centrale.',
    type:'SPECIAL', cat:'PHYSIQUE', diff:8, dur:30, req:[{ stat:'RES', minLv:4 },{ stat:'VIT', minLv:3 }], timed:false,
    rewards:[{ stat:'RES', xp:60 },{ stat:'VIT', xp:45 }],
    protocol:['10 min core control','3 set carry o hollow hold','2 min posture reset','Nota su energia post-task'],
    science:'La stabilita del tronco riduce costo energetico e migliora resilienza meccanica.', icon:'🪢', equipmentId:'CORE_BIND'
  },
  {
    id:'stalker_boots_run', name:'Stalker Boots Run', desc:'Sprint stealth per ottenere gli stivali da mobilita.',
    type:'SPECIAL', cat:'PHYSIQUE', diff:8, dur:32, req:[{ stat:'AGI', minLv:5 },{ stat:'ADA', minLv:3 }], timed:true,
    rewards:[{ stat:'AGI', xp:70 },{ stat:'ADA', xp:40 }],
    protocol:['Interval run 20 min','3 cambi ritmo controllati','2 min cooldown nasale','Debrief sulla fluidita'],
    science:'Cambio di ritmo e adattamento rapido migliorano efficienza locomotoria.', icon:'🥾', equipmentId:'STALKER_BOOTS'
  },
  {
    id:'crimson_flask_brew', name:'Crimson Flask Brew', desc:'Protocollo recovery per il primo flask.',
    type:'SPECIAL', cat:'NEURAL', diff:6, dur:18, req:[{ stat:'VIT', minLv:3 },{ stat:'RES', minLv:3 }], timed:false,
    rewards:[{ stat:'VIT', xp:50 },{ stat:'RES', xp:35 }],
    protocol:['Hydration check','5 min camminata lenta','3 min breathing downshift','Nota sulla percezione di recupero'],
    science:'Recovery attivo e idratazione migliorano disponibilita energetica e recupero.', icon:'🧪', equipmentId:'CRIMSON_FLASK'
  },
  {
    id:'azure_flask_sync', name:'Azure Flask Sync', desc:'Setup mentale rapido per il flask blu da focus.',
    type:'SPECIAL', cat:'COGNITIVE', diff:6, dur:18, req:[{ stat:'FOC', minLv:3 },{ stat:'VAG', minLv:3 }], timed:false,
    rewards:[{ stat:'FOC', xp:50 },{ stat:'VAG', xp:35 }],
    protocol:['2 min respiro 4-6','12 min task single-target','1 min reset schermo spento','Chiudi con obiettivo unico'],
    science:'La modulazione respiratoria prima del focus riduce rumore e aumenta stabilita attentiva.', icon:'🧴', equipmentId:'AZURE_FLASK'
  },
];

const LEGACY_EQUIPMENT_ID_MAP = {
  SHADOW_DAGGER: 'SHADOW_RECURVE',
  MONARCH_VISOR: 'MONARCH_HELM',
  IRON_HEART_ARMOR: 'IRON_HEART_CUIRASS',
  VAGAL_SIGIL: 'VAGAL_AMULET',
};

const LEGACY_SPECIAL_QUEST_MAP = {
  shadow_trial: 'shadow_recurve_trial',
  visor_protocol: 'monarch_helm_scan',
  vagal_relic: 'vagal_amulet_recovery',
};

const LEGACY_SLOT_MAP = {
  WEAPON: 'WEAPON_MAIN',
  HEAD: 'HELMET',
  CHEST: 'BODY',
  ACCESSORY: 'AMULET',
};

Object.assign(EQUIPMENT_CATALOG, {
  HUNTER_LONGBOW: {
    id: 'HUNTER_LONGBOW', slot: 'WEAPON_MAIN', set: 'SHADOWFORGED', name: 'Hunter Longbow', icon: '🏹', rarity: 'RARE',
    desc: 'Versione agile e pulita per run rapidi e precisione costante.', bonuses: { AGI: 1, FOC: 1 },
  },
  OBLIVION_CROWN: {
    id: 'OBLIVION_CROWN', slot: 'HELMET', set: 'MONARCH_SYNTH', name: 'Oblivion Crown', icon: '🪖', rarity: 'EPIC',
    desc: 'Corona tattica per raid cognitivi lunghi e pensiero freddo.', bonuses: { INT: 1, DIS: 1, FOC: 1 },
  },
  ECHO_AMULET: {
    id: 'ECHO_AMULET', slot: 'AMULET', set: 'MONARCH_SYNTH', name: 'Echo Amulet', icon: '🜂', rarity: 'RARE',
    desc: 'Amplifica presenza, tono e regolazione interpersonale.', bonuses: { EMP: 1, CHA: 1, VAG: 1 },
  },
  IRON_LOOP: {
    id: 'IRON_LOOP', slot: 'RING_LEFT', set: 'IRON_HEART', name: 'Iron Loop', icon: '🪙', rarity: 'EPIC',
    desc: 'Anello da carico e tenuta. Ideale nei giorni di volume alto.', bonuses: { STR: 1, RES: 1, VIT: 1 },
  },
  GHOST_RING: {
    id: 'GHOST_RING', slot: 'RING_RIGHT', set: 'SHADOWFORGED', name: 'Ghost Ring', icon: '💠', rarity: 'EPIC',
    desc: 'Riduce attrito mentale e rende i movimenti più invisibili.', bonuses: { AGI: 1, ADA: 1, FOC: 1 },
  },
  TITAN_PLATE: {
    id: 'TITAN_PLATE', slot: 'BODY', set: 'IRON_HEART', name: 'Titan Plate', icon: '🛡️', rarity: 'LEGENDARY',
    desc: 'Armatura boss-tier per build ad alta tenuta e sforzo prolungato.', bonuses: { STR: 2, RES: 2, VIT: 1 },
  },
  SURGE_GAUNTLETS: {
    id: 'SURGE_GAUNTLETS', slot: 'GLOVES', set: 'SHADOWFORGED', name: 'Surge Gauntlets', icon: '🥊', rarity: 'EPIC',
    desc: 'Guanti per output esplosivo e precisione sotto pressione.', bonuses: { STR: 1, AGI: 1, DIS: 1 },
  },
  REINFORCED_SASH: {
    id: 'REINFORCED_SASH', slot: 'BELT', set: 'IRON_HEART', name: 'Reinforced Sash', icon: '🎗️', rarity: 'RARE',
    desc: 'Sash per stabilità centrale e controllo respiratorio.', bonuses: { RES: 1, CO2: 1, VAG: 1 },
  },
  PHANTOM_BOOTS: {
    id: 'PHANTOM_BOOTS', slot: 'BOOTS', set: 'SHADOWFORGED', name: 'Phantom Boots', icon: '👢', rarity: 'LEGENDARY',
    desc: 'Stivali boss-tier per tracking, rapidità e adattamento.', bonuses: { AGI: 2, ADA: 2 },
  },
  GOLDEN_FLASK: {
    id: 'GOLDEN_FLASK', slot: 'FLASK_ONE', set: 'MONARCH_SYNTH', name: 'Golden Flask', icon: '🍯', rarity: 'EPIC',
    desc: 'Flask raro per boss push e spike di volontà.', bonuses: { WIL: 1, FOC: 1, VIT: 1 },
  },
  VOID_FLASK: {
    id: 'VOID_FLASK', slot: 'FLASK_TWO', set: 'MONARCH_SYNTH', name: 'Void Flask', icon: '🧿', rarity: 'LEGENDARY',
    desc: 'Flask d’élite per scan profondi e focus da raid finale.', bonuses: { INT: 1, FOC: 2 },
  },
  ANXIETY_WARD: {
    id: 'ANXIETY_WARD', slot: 'AMULET', set: 'MONARCH_SYNTH', name: 'Anxiety Ward', icon: '🜁', rarity: 'LEGENDARY',
    desc: 'Drop unico del Wraith: calma chirurgica sotto allerta.', bonuses: { VAG: 2, CO2: 1, WIL: 1 },
  },
  GOLEM_CORE: {
    id: 'GOLEM_CORE', slot: 'BELT', set: 'IRON_HEART', name: 'Golem Core', icon: '🧱', rarity: 'LEGENDARY',
    desc: 'Nucleo del Golem: densità, tenuta, resistenza alla letargia.', bonuses: { RES: 2, VIT: 2 },
  },
  LEECH_SPIKE: {
    id: 'LEECH_SPIKE', slot: 'WEAPON_OFF', set: 'SHADOWFORGED', name: 'Leech Spike', icon: '🗡', rarity: 'EPIC',
    desc: 'Drop unico anti-procrastinazione. Aggredisce attrito e inerzia.', bonuses: { DIS: 2, FOC: 1 },
  },
  BERSERKER_EMBLEM: {
    id: 'BERSERKER_EMBLEM', slot: 'RING_RIGHT', set: 'IRON_HEART', name: 'Berserker Emblem', icon: '🔥', rarity: 'LEGENDARY',
    desc: 'Trasforma rabbia grezza in output disciplinato.', bonuses: { STR: 2, WIL: 1, RES: 1 },
  },
  SHAME_MASK: {
    id: 'SHAME_MASK', slot: 'HELMET', set: 'MONARCH_SYNTH', name: 'Shame Mask', icon: '🎭', rarity: 'LEGENDARY',
    desc: 'Neutralizza l’auto-giudizio e stabilizza l’esposizione sociale.', bonuses: { CHA: 2, WIL: 1, EMP: 1 },
  },
  PANIC_CHAIN: {
    id: 'PANIC_CHAIN', slot: 'AMULET', set: 'MONARCH_SYNTH', name: 'Panic Chain', icon: '📿', rarity: 'LEGENDARY',
    desc: 'Ricorda al sistema che il ritmo viene prima della reazione.', bonuses: { CO2: 2, VAG: 1, FOC: 1 },
  },
  WEAVER_CLOAK: {
    id: 'WEAVER_CLOAK', slot: 'BODY', set: 'SHADOWFORGED', name: 'Weaver Cloak', icon: '🕸️', rarity: 'LEGENDARY',
    desc: 'Mantello da rete sociale: ti riporta verso connessioni ad alta qualità.', bonuses: { EMP: 2, CHA: 1, ADA: 1 },
  },
  JUDGE_SEAL: {
    id: 'JUDGE_SEAL', slot: 'RING_LEFT', set: 'IRON_HEART', name: 'Judge Seal', icon: '⚖️', rarity: 'LEGENDARY',
    desc: 'Sigillo anti-perfezionismo, fatto per eseguire e chiudere.', bonuses: { DIS: 2, FOC: 1, INT: 1 },
  },
  CHIMERA_EYE: {
    id: 'CHIMERA_EYE', slot: 'WEAPON_OFF', set: 'SHADOWFORGED', name: 'Chimera Eye', icon: '🦚', rarity: 'LEGENDARY',
    desc: 'Ricalibra il focus sulla tua build, non su quella degli altri.', bonuses: { ADA: 2, WIL: 1, INT: 1 },
  },
});

const SPECIAL_QUEST_LOOT_TABLES = {
  shadow_recurve_trial: [{ itemId:'HUNTER_LONGBOW', weight:65 }, { itemId:'SHADOW_RECURVE', weight:35 }],
  quiver_zero_protocol: [{ itemId:'QUIVER_ZERO', weight:75 }, { itemId:'LEECH_SPIKE', weight:25 }],
  monarch_helm_scan: [{ itemId:'OBLIVION_CROWN', weight:65 }, { itemId:'MONARCH_HELM', weight:35 }],
  vagal_amulet_recovery: [{ itemId:'ECHO_AMULET', weight:70 }, { itemId:'VAGAL_AMULET', weight:30 }],
  lucid_ring_alpha: [{ itemId:'LUCID_RING_ALPHA', weight:70 }, { itemId:'IRON_LOOP', weight:30 }],
  co2_loop_dive: [{ itemId:'CO2_LOOP', weight:70 }, { itemId:'GHOST_RING', weight:30 }],
  iron_heart_forge: [{ itemId:'IRON_HEART_CUIRASS', weight:75 }, { itemId:'TITAN_PLATE', weight:25 }],
  grip_protocol_gloves: [{ itemId:'GRIP_PROTOCOL', weight:70 }, { itemId:'SURGE_GAUNTLETS', weight:30 }],
  core_bind_belt: [{ itemId:'REINFORCED_SASH', weight:65 }, { itemId:'CORE_BIND', weight:35 }],
  stalker_boots_run: [{ itemId:'STALKER_BOOTS', weight:70 }, { itemId:'PHANTOM_BOOTS', weight:30 }],
  crimson_flask_brew: [{ itemId:'CRIMSON_FLASK', weight:70 }, { itemId:'GOLDEN_FLASK', weight:30 }],
  azure_flask_sync: [{ itemId:'AZURE_FLASK', weight:70 }, { itemId:'VOID_FLASK', weight:30 }],
};

const BOSS_DROP_TABLES = {
  ANXIETY_WRAITH: [{ itemId:'ANXIETY_WARD', weight:100 }],
  LETHARGY_GOLEM: [{ itemId:'GOLEM_CORE', weight:100 }],
  PROCRASTINATION_LEECH: [{ itemId:'LEECH_SPIKE', weight:100 }],
  ANGER_BERSERKER: [{ itemId:'BERSERKER_EMBLEM', weight:100 }],
  SHAME_SIREN: [{ itemId:'SHAME_MASK', weight:100 }],
  PANIC_HYDRA: [{ itemId:'PANIC_CHAIN', weight:100 }],
  ISOLATION_WEAVER: [{ itemId:'WEAVER_CLOAK', weight:100 }],
  PERFECTION_JUDGE: [{ itemId:'JUDGE_SEAL', weight:100 }],
  ENVY_CHIMERA: [{ itemId:'CHIMERA_EYE', weight:100 }],
};

const BOSS_SET_UPGRADES = {
  ANXIETY_WRAITH: { setId:'MONARCH_SYNTH', bonuses:{ VAG:1 } },
  LETHARGY_GOLEM: { setId:'IRON_HEART', bonuses:{ RES:1 } },
  PROCRASTINATION_LEECH: { setId:'SHADOWFORGED', bonuses:{ DIS:1 } },
  ANGER_BERSERKER: { setId:'IRON_HEART', bonuses:{ STR:1 } },
  SHAME_SIREN: { setId:'MONARCH_SYNTH', bonuses:{ CHA:1 } },
  PANIC_HYDRA: { setId:'MONARCH_SYNTH', bonuses:{ CO2:1 } },
  ISOLATION_WEAVER: { setId:'SHADOWFORGED', bonuses:{ EMP:1 } },
  PERFECTION_JUDGE: { setId:'IRON_HEART', bonuses:{ DIS:1 } },
  ENVY_CHIMERA: { setId:'SHADOWFORGED', bonuses:{ ADA:1 } },
};

const FLASK_EFFECTS = {
  CRIMSON_FLASK: { name:'Crimson Flask Burst', icon:'🧪', cooldownMs: 1000 * 60 * 8, buffId:'IRON_HEART' },
  GOLDEN_FLASK: { name:'Golden Flask Surge', icon:'🍯', cooldownMs: 1000 * 60 * 12, buffId:'XP_CRYSTAL' },
  AZURE_FLASK: { name:'Azure Flask Focus', icon:'🧴', cooldownMs: 1000 * 60 * 8, buffId:'FOCUS_SHARD' },
  VOID_FLASK: { name:'Void Flask Overclock', icon:'🧿', cooldownMs: 1000 * 60 * 14, buffId:'NEURAL_SURGE' },
};

const MATERIAL_CATALOG = {
  SHADOW_SHARD: { id:'SHADOW_SHARD', name:'Shadow Shard', icon:'🌑', desc:'Frammento da mobility, stealth e output rapido.' },
  MONARCH_FRAGMENT: { id:'MONARCH_FRAGMENT', name:'Monarch Fragment', icon:'👁', desc:'Scheggia cognitiva per set da focus, social e scan.' },
  IRON_ORE: { id:'IRON_ORE', name:'Iron Ore', icon:'⛓️', desc:'Materiale da resilienza, tankiness e build ad alta tenuta.' },
  BOSS_CORE: { id:'BOSS_CORE', name:'Boss Core', icon:'💠', desc:'Catalizzatore raro necessario per i livelli di forge superiori.' },
};

const SET_PRIMARY_MATERIAL = {
  SHADOWFORGED: 'SHADOW_SHARD',
  MONARCH_SYNTH: 'MONARCH_FRAGMENT',
  IRON_HEART: 'IRON_ORE',
};

const UPGRADE_MAX_LEVEL = 3;
const UPGRADE_RARITY_BASE = {
  RARE: { main: 2, core: 0 },
  EPIC: { main: 3, core: 1 },
  LEGENDARY: { main: 4, core: 1 },
};

// ========================
// FACTIONS
// ========================

const FACTION_DEFINITIONS = [
  { id:'PHYSIQUE',  name:'Corpo di Ferro',  icon:'💪', color:'#FF55BB' },
  { id:'COGNITIVE', name:'Mente Ascesa',     icon:'🧠', color:'#00FFCC' },
  { id:'NEURAL',    name:'Spirito Profondo', icon:'🧘', color:'#33BBFF' },
  { id:'SOCIAL',    name:'Cerchio Interno',  icon:'🤝', color:'#BB77FF' },
];

const FACTION_RANKS = [
  { rep:0,    name:'Iniziato',     mult:1.0  },
  { rep:100,  name:'Adepto',       mult:1.05 },
  { rep:300,  name:'Veterano',     mult:1.10 },
  { rep:600,  name:'Maestro',      mult:1.15 },
  { rep:1000, name:'Gran Maestro', mult:1.20 },
  { rep:2000, name:'Leggenda',     mult:1.30 },
];

// ========================
// DEBUFFS & TITLES
// ========================

const DEBUFF_TEMPLATES = {
  ANXIETY:        { name:'Anxiety Signal',      icon:'⚡', cats:['INT','FOC','CHA'], mult:0.75 },
  LETHARGY:       { name:'Neural Fog',           icon:'🌫️', cats:['INT','FOC','STR'], mult:0.7  },
  SYMPATHETIC:    { name:'Fight-or-Flight Lock',  icon:'🔴', cats:['FOC','CHA','EMP'], mult:0.6  },
  SLEEP_DEBT:     { name:'Sleep Debt',            icon:'😴', cats:['INT','FOC','STR','AGI'], mult:0.65 },
  RESPIRATORY:    { name:'CO2 Intolerance',       icon:'💨', cats:['RES','CO2','VIT'],  mult:0.8  },
  OVERTRAINING:   { name:'Allostatic Overload',   icon:'💀', cats:['STR','RES','AGI','FOC','WIL'], mult:0.4 },
};

const TITLES = [
  {lv:0,t:'Neophyte'},{lv:5,t:'Awakened'},{lv:10,t:'Shadow Initiate'},
  {lv:20,t:'Neural Adept'},{lv:30,t:'Dungeon Walker'},{lv:40,t:'Shadow Commander'},
  {lv:60,t:'Monarch of Flow'},{lv:80,t:'Shadow Monarch'},{lv:120,t:'Transcendent'},
];

const AVATAR_EMOJI_OPTIONS = ['🛡️','⚡','🧠','🔥','🌑','👁️','🧬','🦁','🐺','🦅','🦊','🐉'];
const AVATAR_COLOR_OPTIONS = ['#00D4FF','#9050FF','#FF3366','#FFB800','#00FF88','#44DDFF','#FF8844','#BB77FF'];

const LEGACY_100_LIST = [
  'Vedere l’alba da una montagna',
  'Nuotare in un lago glaciale',
  'Scrivere un manifesto personale',
  'Imparare una lingua nuova',
  'Dormire sotto le stelle',
  'Leggere 100 libri fondamentali',
  'Fare un viaggio da solo',
  'Correre una mezza maratona',
  'Imparare a meditare davvero',
  'Dire una verità che stai evitando',
  'Visitare il Giappone',
  'Vedere l’aurora boreale',
  'Creare un progetto artistico tuo',
  'Pubblicare qualcosa di importante',
  'Imparare a cucinare 10 piatti forti',
  'Passare una settimana offline',
  'Imparare un’arte marziale',
  'Andare in Islanda',
  'Imparare a suonare uno strumento',
  'Costruire una morning routine solida',
  'Fare volontariato serio',
  'Visitare una foresta antica',
  'Fare un discorso pubblico memorabile',
  'Lanciare un business o side project',
  'Vedere un deserto vero',
  'Imparare a nuotare bene',
  'Camminare per 30 km in un giorno',
  'Imparare il primo soccorso',
  'Portare a termine un anno di journaling',
  'Fare pace con una paura storica',
  'Vivere un mese all’estero',
  'Visitare una grande biblioteca storica',
  'Creare un album di ricordi importante',
  'Imparare a gestire il denaro con disciplina',
  'Vedere una finale sportiva dal vivo',
  'Imparare a danzare',
  'Scrivere una lettera a te stesso del futuro',
  'Disintossicarti da un’abitudine tossica',
  'Fare una notte intera in rifugio',
  'Imparare a respirare sotto stress',
  'Visitare un tempio o monastero',
  'Avere il fisico migliore della tua vita',
  'Chiudere una relazione tossica',
  'Imparare a fotografare bene',
  'Passare una giornata intera in silenzio',
  'Guidare lungo una costa iconica',
  'Fare un retreat personale',
  'Imparare a fare pane o pizza perfetti',
  'Guardare un’eclissi o pioggia meteorica',
  'Imparare a difenderti in acqua',
  'Vedere New York almeno una volta',
  'Vivere una settimana in montagna',
  'Trovare una causa che senti tua',
  'Leggere i classici che contano davvero',
  'Creare una stanza o studio ideale',
  'Fare un viaggio in treno epico',
  'Imparare a stare da solo senza scappare',
  'Fare un tatuaggio simbolico o decidere di non farlo con coscienza',
  'Mangiare in un ristorante stellato o leggendario',
  'Avere una conversazione che ti cambia',
  'Vedere Roma di notte da solo',
  'Visitare un vulcano',
  'Imparare a scalare',
  'Dormire in tenda in un luogo remoto',
  'Costruire una collezione significativa',
  'Scrivere un testo o libro lungo',
  'Portare i genitori o chi ami in un viaggio bello',
  'Imparare a lasciare andare il controllo',
  'Fare un anno senza fumare o vizio dominante',
  'Creare una playlist della tua vita',
  'Imparare a stare sul palco',
  'Vedere un concerto da sogno',
  'Camminare in una città sconosciuta all’alba',
  'Avere una libreria piena di libri amati',
  'Fare un bagno in mare in inverno',
  'Imparare a dire no senza colpa',
  'Chiudere un progetto fermo da anni',
  'Imparare a scrivere bene a mano',
  'Fare un’esperienza in vela o barca',
  'Imparare una skill manuale concreta',
  'Vivere un giorno perfetto progettato da te',
  'Vedere un grande museo mondiale',
  'Rivedere i luoghi della tua infanzia',
  'Imparare a dormire bene in modo stabile',
  'Raggiungere una vera pace col corpo',
  'Trovare un luogo nel mondo che senti casa',
  'Avere un amico o alleato assoluto',
  'Fare una traversata lunga a piedi',
  'Imparare a parlare in modo magnetico',
  'Andare a un festival o evento unico',
  'Creare una tradizione tua',
  'Fare una foto di cui sarai fiero per sempre',
  'Insegnare a qualcuno qualcosa che conta',
  'Vedere la neve in un luogo iconico',
  'Toccare un livello vero di disciplina',
  'Imparare a stare nel presente',
  'Costruire un’eredità digitale o reale',
  'Fare una dichiarazione d’amore o stima sincera',
  'Chiudere i conti con una ferita del passato',
  'Vivere almeno un anno sentendoti pienamente te stesso',
  'Creare la tua lista definitiva di valori',
  'Avere una casa o base che ti rappresenti',
  'Lasciare il mondo un po’ migliore di come l’hai trovato',
];

const RANK_TABLE = [{r:'S',d:9},{r:'A',d:7},{r:'B',d:5},{r:'C',d:4},{r:'D',d:2},{r:'E',d:0}];

// ========================
// GAME STATE
// ========================

const DEFAULT_STATE = {
  version: 3,
  playerName: '',
  playerClass: null,
  classLevel: 1,
  onboardingRank: 1,
  stats: {},
  totalXP: 0,
  currentStreak: 0,
  questsCompleted: 0,
  bossesDefeated: [],
  assessmentHistory: [],
  activeDebuffs: [],
  todayCompleted: [],
  lastAssessmentDate: null,
  onboardingDone: false,
  companionHistory: [],
  // MMORPG additions
  weeklyCompleted: [],
  lastWeeklyReset: null,
  chainProgress: {},
  todayCombos: [],
  totalCombos: 0,
  achievements: [],
  inventory: [],
  factionRep: { PHYSIQUE:0, COGNITIVE:0, NEURAL:0, SOCIAL:0 },
  criticalHits: 0,
  todayCompletedDetails: [],
  questTab: 'corpo',
  customQuests: [],
  ownedEquipment: [],
  equippedGear: createEmptyGearSlots(),
  specialQuestCompleted: [],
  setUpgrades: {},
  flaskCooldowns: {},
  materials: {},
  equipmentUpgrades: {},
  codexTab: 'rank',
  bucketListChecks: {},
  avatarEmoji: '🛡️',
  avatarColor: '#00D4FF',
  profileStrengths: '',
  profileWeaknesses: '',
  profileFears: '',
  bossTitles: [],
  activeBossTitle: null,
  startHere: {
    startedAt: null,
    basicsReviewed: false,
    adaptiveReviewed: false,
    weeklyRecapReviewed: false,
    buildPath: null,
  },
};

let state = loadState(); // Carica subito da localStorage

// Helper: find quest by ID across built-in + custom
function findQuestById(id) {
  return QUEST_DEFINITIONS.find(q => q.id === id)
    || SPECIAL_QUESTS.find(q => q.id === id)
    || (state.customQuests || []).find(q => q.id === id);
}

function loadState() {
  return readStoredState() || { ...DEFAULT_STATE };
}

function initStats() {
  if (Object.keys(state.stats).length > 0) return;
  for (const s of PRIMARY_STATS)   state.stats[s.id] = { lv:1, xp:0 };
  for (const s of SECONDARY_STATS) state.stats[s.id] = { lv:1, xp:0 };
  saveState();
}

// ========================
// GAME LOGIC HELPERS
// ========================

function xpForLevel(lv) { return Math.floor(28 + Math.pow(lv, 1.28) * 18); }

function xpForHunterRank(rank) {
  return Math.floor(36 + Math.pow(rank, 1.24) * 18);
}

function getStatLv(id) { return state.stats[id]?.lv ?? 1; }

function getEquipmentBonusForStat(statId) {
  const equipped = state.equippedGear || {};
  const itemBonus = Object.values(equipped).reduce((sum, itemId) => {
    if (!itemId) return sum;
    const item = EQUIPMENT_CATALOG[itemId];
    return sum + (getItemBonuses(item)?.[statId] || 0);
  }, 0);
  return itemBonus + getSetBonusForStat(statId) + getSetUpgradeBonusForStat(statId);
}

function getEquippedSetCounts() {
  return Object.values(state.equippedGear || {}).reduce((acc, itemId) => {
    const setId = itemId ? EQUIPMENT_CATALOG[itemId]?.set : null;
    if (!setId) return acc;
    acc[setId] = (acc[setId] || 0) + 1;
    return acc;
  }, {});
}

function getActiveSetBonuses() {
  const counts = getEquippedSetCounts();
  return Object.entries(counts).map(([setId, count]) => {
    const setDef = EQUIPMENT_SET_BONUSES[setId];
    if (!setDef) return null;
    const activeThresholds = Object.keys(setDef.thresholds)
      .map(Number)
      .filter(threshold => count >= threshold)
      .sort((a, b) => a - b);
    if (!activeThresholds.length) return null;
    return {
      setId,
      count,
      setDef,
      bonuses: activeThresholds.map(threshold => ({ threshold, stats: setDef.thresholds[threshold] })),
    };
  }).filter(Boolean);
}

function getSetBonusForStat(statId) {
  return getActiveSetBonuses().reduce((sum, bonus) => {
    return sum + bonus.bonuses.reduce((inner, thresholdBonus) => inner + (thresholdBonus.stats[statId] || 0), 0);
  }, 0);
}

function getEffectiveStatLv(id) {
  return getStatLv(id) + getEquipmentBonusForStat(id);
}

function addStatXP(id, amount) {
  if (!state.stats[id]) state.stats[id] = { lv:1, xp:0 };
  const s = state.stats[id];
  const def = [...PRIMARY_STATS,...SECONDARY_STATS].find(d=>d.id===id);
  const cap = def?.maxLv ?? 50;
  s.xp += amount;
  let leveled = false;
  while (s.lv < cap && s.xp >= xpForLevel(s.lv+1)) { s.xp -= xpForLevel(s.lv+1); s.lv++; leveled = true; }
  return leveled;
}

function getTotalLevel() {
  return getHunterRankInfo().rank;
}

function getHunterRankInfo() {
  let rank = Math.max(1, Math.min(20, state.onboardingRank || 1));
  let xpPool = Math.max(0, state.totalXP || 0);
  while (rank < 99) {
    const need = xpForHunterRank(rank + 1);
    if (xpPool < need) return { rank, xpIntoRank: xpPool, nextXp: need };
    xpPool -= need;
    rank++;
  }
  return { rank: 99, xpIntoRank: 0, nextXp: 0 };
}

function getRankTitle() {
  const lv = getTotalLevel();
  let title = 'Neophyte';
  for (const t of TITLES) { if (lv >= t.lv) title = t.t; }
  return title;
}

function getUnlockedRankTitles() {
  const lv = getTotalLevel();
  return TITLES.filter(t => lv >= t.lv).map(t => t.t);
}

function getSelectableTitles() {
  const rankTitles = getUnlockedRankTitles().map(title => ({ title, origin:'rank' }));
  const bossTitles = [...new Set(state.bossTitles || [])].map(title => ({ title, origin:'boss' }));
  const merged = [...rankTitles, ...bossTitles];
  return merged.filter((entry, index) => merged.findIndex(other => other.title === entry.title) === index);
}

function setActiveTitle(title) {
  state.activeBossTitle = title || null;
  saveState();
}

function getTitle() {
  if (state.activeBossTitle) return state.activeBossTitle;
  return getRankTitle();
}

function scoreQuestAgainstSignals(quest, signals, source) {
  if (!signals.length) return 0;
  let score = 0;
  for (const signal of signals) {
    if ((signal.questIds || []).includes(quest.id)) score += source === 'strengths' ? 6 : 8;
    if ((signal.stats || []).some(statId => quest.rewards.some(reward => reward.stat === statId))) score += source === 'strengths' ? 3 : 4;
    if ((signal.stats || []).some(statId => quest.req.some(req => req.stat === statId))) score += 1;
  }
  if (source === 'strengths' && quest.type === 'SPECIAL') score += 1;
  if (source !== 'strengths' && quest.type === 'RECOVERY') score += 2;
  return score;
}

function scoreBossAgainstSignals(boss, signals, source) {
  if (!signals.length) return 0;
  let score = 0;
  for (const signal of signals) {
    if ((signal.bossIds || []).includes(boss.id)) score += source === 'strengths' ? 5 : 9;
    if ((signal.stats || []).some(statId => boss.req.some(req => req.stat === statId))) score += 2;
  }
  if (source === 'fears') score += 1;
  return score;
}

function chooseRecommendedQuest(source) {
  const text = source === 'strengths' ? state.profileStrengths : source === 'weaknesses' ? state.profileWeaknesses : state.profileFears;
  const signals = getTraitSignals(text);
  const available = getAvailableQuests(state.assessmentHistory[state.assessmentHistory.length - 1] || null)
    .filter(quest => !getDoneInfo(quest.id));
  if (!available.length) return null;

  const scored = available
    .map(quest => ({ quest, score: scoreQuestAgainstSignals(quest, signals, source) }))
    .sort((a, b) => b.score - a.score || a.quest.diff - b.quest.diff);

  if (scored[0]?.score > 0) return scored[0].quest;

  if (source === 'strengths') return available.find(quest => quest.type === 'SPECIAL') || available[0];
  if (source === 'weaknesses') return available.find(quest => quest.type === 'RECOVERY' || quest.cat === 'NEURAL') || available[0];
  return available.find(quest => quest.cat === 'SOCIAL' || quest.cat === 'NEURAL') || available[0];
}

function chooseSuggestedBoss(source) {
  const text = source === 'strengths' ? state.profileStrengths : source === 'weaknesses' ? state.profileWeaknesses : state.profileFears;
  const signals = getTraitSignals(text);
  const bosses = BOSS_DEFINITIONS.filter(boss => !state.bossesDefeated.includes(boss.id));
  if (!bosses.length) return null;

  const scored = bosses
    .map(boss => ({
      boss,
      score: scoreBossAgainstSignals(boss, signals, source),
      campaignScore: getBossCampaignPriorityScore(boss, source),
      ready: meetsReq(boss.req),
    }))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || (b.score + b.campaignScore) - (a.score + a.campaignScore) || a.boss.level - b.boss.level);

  if ((scored[0]?.score || 0) + (scored[0]?.campaignScore || 0) > 0) return scored[0].boss;

  if (source === 'strengths') return scored.find(entry => entry.ready)?.boss || scored[0].boss;
  if (source === 'weaknesses') return scored.find(entry => !entry.ready && entry.campaignScore > 0)?.boss || bosses.find(boss => !meetsReq(boss.req)) || bosses[0];
  return scored.find(entry => entry.campaignScore > 0)?.boss || bosses.find(boss => ['ANXIETY_WRAITH','PANIC_HYDRA','SHAME_SIREN'].includes(boss.id)) || bosses[0];
}

function getProfileRecommendations() {
  return {
    strengths: {
      label: TRAIT_SOURCE_LABELS.strengths,
      text: state.profileStrengths,
      quest: chooseRecommendedQuest('strengths'),
      boss: chooseSuggestedBoss('strengths'),
    },
    weaknesses: {
      label: TRAIT_SOURCE_LABELS.weaknesses,
      text: state.profileWeaknesses,
      quest: chooseRecommendedQuest('weaknesses'),
      boss: chooseSuggestedBoss('weaknesses'),
    },
    fears: {
      label: TRAIT_SOURCE_LABELS.fears,
      text: state.profileFears,
      quest: chooseRecommendedQuest('fears'),
      boss: chooseSuggestedBoss('fears'),
    },
  };
}

function getLatestAssessment() {
  return state.assessmentHistory[state.assessmentHistory.length - 1] || null;
}

function hasTodayAssessment() {
  return state.lastAssessmentDate === new Date().toDateString() && !!getLatestAssessment();
}

function getFactionDefinition(cat) {
  return FACTION_DEFINITIONS.find(faction => faction.id === cat) || null;
}

function getTotalFactionRepValue() {
  return Object.values(state.factionRep || {}).reduce((sum, value) => sum + (value || 0), 0);
}

function getLeadFactionProgress() {
  const entries = FACTION_DEFINITIONS.map(faction => ({
    faction,
    rep: state.factionRep?.[faction.id] ?? 0,
  })).sort((left, right) => right.rep - left.rep);
  return entries[0] || null;
}

function renderProgressLayers() {
  const root = $('progressLayersBlock');
  if (!root) return;

  const classDef = CLASS_DEFINITIONS.find(c => c.id === state.playerClass) || null;
  const rankInfo = getHunterRankInfo();
  const startingRank = Math.max(1, Math.min(20, state.onboardingRank || 1));
  const earnedRankGain = Math.max(0, rankInfo.rank - startingRank);
  const topPrimary = [...PRIMARY_STATS]
    .sort((left, right) => getEffectiveStatLv(right.id) - getEffectiveStatLv(left.id))
    .slice(0, 2);
  const totalFactionRep = getTotalFactionRepValue();
  const leadFaction = getLeadFactionProgress();
  const gearCount = getOwnedEquipmentItems().length;
  const hasEarnedProgress = (state.questsCompleted || 0) > 0
    || state.bossesDefeated.length > 0
    || (state.totalXP || 0) > 0
    || state.currentStreak > 0
    || totalFactionRep > 0
    || gearCount > 0;

  root.innerHTML = `
    <section class="progress-layers-shell" aria-label="Progression layers">
      <div class="progress-layers-head">
        <div>
          <div class="progress-layers-kicker">PROGRESSION READOUT</div>
          <h2 class="progress-layers-title">Current Power Explained</h2>
          <p class="progress-layers-sub">Hunter Rank combines your initial build analysis with the progression you have truly earned after onboarding.</p>
        </div>
        <div class="progress-rank-summary">
          <span class="progress-rank-current">Rank ${rankInfo.rank}</span>
          <span class="progress-rank-formula">Start ${startingRank} + Earned ${earnedRankGain}</span>
        </div>
      </div>
      <div class="progress-layers-grid">
        <article class="progress-layer-card progress-layer-start">
          <div class="progress-layer-label">Starting Build Power</div>
          <div class="progress-layer-value">Assessment Rank ${startingRank}</div>
          <p class="progress-layer-copy">This opening power comes from your initial assessment and build analysis. It defines your starting profile before any real quest or boss progression.</p>
          <div class="progress-layer-metrics">
            <div class="progress-layer-metric">
              <span>Assigned Class</span>
              <strong>${classDef ? `${classDef.icon} ${escapeHtml(classDef.name)}` : 'Not assigned'}</strong>
            </div>
            <div class="progress-layer-metric">
              <span>Build Signature</span>
              <strong>${topPrimary.length ? topPrimary.map(stat => `${stat.icon} ${escapeHtml(stat.name)}`).join(' · ') : 'Pending analysis'}</strong>
            </div>
          </div>
        </article>
        <article class="progress-layer-card progress-layer-earned ${hasEarnedProgress ? 'has-progress' : 'is-empty'}">
          <div class="progress-layer-label">Earned Progression</div>
          <div class="progress-layer-value">${hasEarnedProgress ? `+${earnedRankGain} earned rank` : 'No earned progression yet'}</div>
          <p class="progress-layer-copy">These numbers start at zero after onboarding and grow only through real actions: quests, boss clears, earned XP, streak consistency, factions and gear gained.</p>
          <div class="progress-earned-grid">
            <div class="progress-earned-item"><span>Quest Completion</span><strong>${state.questsCompleted}</strong></div>
            <div class="progress-earned-item"><span>Boss Clears</span><strong>${state.bossesDefeated.length}</strong></div>
            <div class="progress-earned-item"><span>Earned XP</span><strong>${state.totalXP}</strong></div>
            <div class="progress-earned-item"><span>Streak</span><strong>${state.currentStreak}</strong></div>
            <div class="progress-earned-item"><span>Faction Reputation</span><strong>${leadFaction ? `${leadFaction.faction.icon} ${leadFaction.rep} REP` : `${totalFactionRep} REP`}</strong></div>
            <div class="progress-earned-item"><span>Gear Gained</span><strong>${gearCount}</strong></div>
          </div>
        </article>
      </div>
    </section>`;
}

function getQuestTabIdForQuest(quest) {
  if (!quest) return 'corpo';
  if (quest.type === 'SPECIAL') return 'special';
  if (quest.timed) return 'timed';
  if (quest.type === 'RECOVERY' || quest.cat === 'SOCIAL') return 'emozioni';
  if (quest.cat === 'COGNITIVE' || quest.cat === 'NEURAL') return 'mente';
  return 'corpo';
}

function getRecommendedMissionMode(assessment, quest) {
  if (!assessment || !quest) return 'medium';
  if (isForcedRest() || assessment.ansState === 'SYMPATHETIC' || assessment.sleep <= 4 || assessment.energy <= 4) return 'easy';
  if (quest.type === 'SPECIAL' && assessment.energy >= 7 && assessment.sleep >= 7 && assessment.mood >= 6) return 'hard';
  return 'medium';
}

function estimateQuestOutcome(quest, mode='medium') {
  if (!quest) return null;
  const modeInfo = DIFFICULTY_MODES[mode] || DIFFICULTY_MODES.medium;
  const diffEff = Math.max(1, quest.diff + modeInfo.diffOffset);
  const rarity = getQuestRarity(diffEff);
  const rarityMult = RARITY_MULT[rarity];
  const buffMult = getBuffXPMult();
  const factionMult = getFactionMult(quest.cat);
  const dailyBonus = getDailyBonus();
  const faction = getFactionDefinition(quest.cat);
  let dailyMult = 1;

  if (dailyBonus.questId === quest.id && dailyBonus.bonus === '2X_XP') dailyMult = 2;

  let totalXP = 0;
  for (const reward of quest.rewards) {
    const pen = getDebuffPenalty(reward.stat);
    let effective = calcXP(reward.xp, diffEff, state.currentStreak, pen);
    effective = Math.round(effective * rarityMult * modeInfo.xpMult * buffMult * factionMult * dailyMult);
    effective += getBuffBonusXP(reward.stat);
    totalXP += effective;
  }

  const repGain = Math.round(10 * rarityMult * modeInfo.xpMult);
  const streakPct = Math.round(Math.min(state.currentStreak * 5, 50));
  const lootItems = quest.type === 'SPECIAL' ? getQuestLootItems(quest) : [];
  const materialSetId = quest.type === 'SPECIAL'
    ? (lootItems[0]?.set || 'IRON_HEART')
    : ({ PHYSIQUE:'IRON_HEART', COGNITIVE:'MONARCH_SYNTH', NEURAL:'MONARCH_SYNTH', SOCIAL:'SHADOWFORGED' }[quest.cat] || 'IRON_HEART');
  const material = MATERIAL_CATALOG[SET_PRIMARY_MATERIAL[materialSetId]] || null;
  const materialAmount = quest.type === 'SPECIAL' ? 2 : mode === 'hard' ? 2 : 1;

  let itemProgress = 'Nessun progresso gear diretto';
  if (lootItems.length > 0) {
    itemProgress = `${lootItems[0].icon} ${lootItems[0].name}${lootItems.length > 1 ? ` +${lootItems.length - 1} varianti` : ''}`;
  } else if (material) {
    itemProgress = `${material.icon} ${material.name} x${materialAmount}`;
  }

  return {
    totalXP,
    streakPct,
    repGain,
    itemProgress,
    faction,
    modeInfo,
    rarity,
  };
}

function formatAssessmentLockTime(assessment) {
  if (!assessment?.date) return null;
  const parsed = new Date(assessment.date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function buildTodayMissionReason(scanReady, missionSource, assessment, mission, lowRecoveryWindow) {
  if (!scanReady || !assessment || !mission) {
    return 'Finche il Daily Scan non e valido, il sistema non promuove nessuna missione come comando affidabile.';
  }
  if (lowRecoveryWindow) {
    return `Recovery prima di tutto: energia ${assessment.energy}/10 e sonno ${assessment.sleep}/10 chiedono controllo, non overload.`;
  }
  if (missionSource === 'fears') {
    return `Mood basso ma finestra ancora utile: il comando di oggi converte avoidance in esposizione controllata.`;
  }
  if (mission.type === 'SPECIAL') {
    return `Finestra ad alto valore confermata: i biomarcatori supportano un push che puo tradursi in gear o materiali reali.`;
  }
  if (missionSource === 'strengths') {
    return 'La build e sopra soglia sui tuoi punti forti: oggi conviene spingere dove il sistema puo convertire meglio il momentum.';
  }
  return 'Il comando punta il tuo punto fragile piu utile: progressione concreta con attrito ancora gestibile.';
}

function buildTodayRewardExpectation(scanReady, rewardPreview, mission) {
  if (!scanReady || !rewardPreview || !mission) {
    return 'Reward forecast offline finche il Daily Scan non riattiva routing, mode selection e rischio.';
  }
  const primaryReward = rewardPreview.itemProgress || 'Nessun progresso gear diretto';
  return `${rewardPreview.modeInfo.icon} ${rewardPreview.modeInfo.label} · +${rewardPreview.totalXP} XP attesi · ${primaryReward}.`;
}

function buildTodayScanPanel(scanReady, assessment, lowRecoveryWindow, mission, bossDirective, rewardPreview) {
  if (!scanReady || !assessment) {
    return {
      panelClass: 'missing',
      lockLabel: 'SCAN OFFLINE',
      lockValue: 'NO VALID READ',
      copy: 'Mission routing, boss verdict e reward expectation restano in modalita fallback finche non esegui il Daily Scan.',
      items: [
        { label: 'Mission Routing', value: 'LOCKED', tone: 'warning' },
        { label: 'Boss Verdict', value: 'LOCKED', tone: 'warning' },
        { label: 'Reward Forecast', value: 'LOCKED', tone: 'warning' },
      ],
    };
  }

  const recoveryState = lowRecoveryWindow ? 'CAUTION' : 'OPEN';
  return {
    panelClass: lowRecoveryWindow ? 'recovery' : 'live',
    lockLabel: 'SCAN LOCKED',
    lockValue: formatAssessmentLockTime(assessment) || 'NOW',
    copy: lowRecoveryWindow
      ? 'Il Daily Scan ha abbassato il profilo di rischio: oggi il control room privilegia stabilizzazione e pulizia.'
      : 'Il Daily Scan ha attivato il control room: missione, boss e reward sono stati ricalcolati sul tuo stato reale di oggi.',
    items: [
      { label: 'ANS', value: assessment.ansState, tone: lowRecoveryWindow ? 'warning' : 'success' },
      { label: 'Mission', value: mission ? mission.icon : 'N/D', tone: mission ? 'success' : 'warning' },
      { label: 'Boss', value: bossDirective.kind === 'engage' ? 'ENGAGE' : 'CAUTION', tone: bossDirective.kind === 'engage' ? 'success' : 'warning' },
      { label: 'Reward', value: rewardPreview ? `+${rewardPreview.totalXP} XP` : 'PENDING', tone: rewardPreview ? 'success' : 'warning' },
      { label: 'Window', value: recoveryState, tone: lowRecoveryWindow ? 'warning' : 'success' },
    ],
  };
}

function getTodayBossDirective(assessment, scanReady, lowRecoveryWindow) {
  const strengthsBoss = chooseSuggestedBoss('strengths');
  const weaknessesBoss = chooseSuggestedBoss('weaknesses');
  const fearsBoss = chooseSuggestedBoss('fears');
  const engageBoss = strengthsBoss && meetsReq(strengthsBoss.req) ? strengthsBoss : null;
  const fallbackBoss = fearsBoss || weaknessesBoss || strengthsBoss || null;
  const fallbackCampaign = getBossCampaignEffects(fallbackBoss);

  if (!scanReady) {
    return {
      kind: 'avoid',
      source: 'scan',
      boss: fallbackBoss,
      title: 'Scan richiesto prima del raid',
      summary: 'Senza Daily Scan il sistema non valida un ingaggio boss. Prima aggiorna biomarcatori e rischio.',
      windowLabel: 'Caution State',
      windowTone: 'warning',
      tacticalReason: `Boss routing offline: senza biomarcatori aggiornati il sistema non apre una engage window credibile.${fallbackCampaign.length ? ` Esiste una branch campagna su ${fallbackBoss?.icon || ''} ${fallbackBoss?.name || 'questo target'}, ma resta sospesa finché non fai il Daily Scan.` : ''}`,
      campaignLines: fallbackCampaign.slice(0, 2).map(effect => formatCampaignEffectLine(effect)),
      ctaLabel: 'Open Boss Chamber',
    };
  }

  if (lowRecoveryWindow) {
    const boss = fearsBoss || weaknessesBoss || fallbackBoss;
    const campaignEffects = getBossCampaignEffects(boss);
    return {
      kind: 'avoid',
      source: boss === fearsBoss ? 'fears' : 'weaknesses',
      boss,
      title: 'Boss da evitare oggi',
      summary: campaignEffects.length
        ? 'La campagna ha aperto vantaggi su questo boss, ma oggi il sistema privilegia recovery, controllo e progressione sicura.'
        : 'Oggi il sistema privilegia recovery, controllo e progressione sicura. Evita un fight ad alto attrito.',
      windowLabel: 'Caution State',
      windowTone: 'warning',
      tacticalReason: `Recovery fragile: il costo di ingaggio e superiore al valore atteso del pull di oggi.${campaignEffects.length ? ` La branch campagna resta viva su ${boss.icon} ${boss.name}, ma conviene preservarla per una finestra piu pulita.` : ''}`,
      campaignLines: campaignEffects.slice(0, 2).map(effect => formatCampaignEffectLine(effect)),
      ctaLabel: 'Review Boss Risk',
    };
  }

  if (engageBoss) {
    const campaignEffects = getBossCampaignEffects(engageBoss);
    const hasSaferWindow = campaignEffects.some(effect => (effect.durationMult || 1) < 1 || !!effect.damageBonus || !!effect.advantage);
    return {
      kind: 'engage',
      source: 'strengths',
      boss: engageBoss,
      title: campaignEffects.length ? 'Boss campagna consigliato ora' : 'Boss consigliato ora',
      summary: campaignEffects.length
        ? 'Una vittoria precedente ha alterato questo encounter. Oggi puoi convertire quel vantaggio in progressione reale.'
        : 'Il tuo stato attuale supporta un tentativo boss. Questa e la finestra migliore per convertire momentum in progressione.',
      windowLabel: campaignEffects.length ? (hasSaferWindow ? 'Safer Engage Window' : 'Campaign Engage') : 'Engage Window',
      windowTone: 'success',
      tacticalReason: `Requisiti attivi e biomarcatori puliti: il rischio è abbastanza sotto controllo per un tentativo reale.${campaignEffects.length ? ` Inoltre ${campaignEffects[0].sourceBoss?.icon || '☠'} ${campaignEffects[0].sourceBoss?.name || campaignEffects[0].sourceBossId} ha gia deformato il fight: ${campaignEffects[0].summary}` : ''}`,
      campaignLines: campaignEffects.slice(0, 3).map(effect => formatCampaignEffectLine(effect)),
      ctaLabel: 'Open Boss Chamber',
    };
  }

  const prepCampaign = getBossCampaignEffects(fallbackBoss);

  return {
    kind: 'avoid',
    source: fallbackBoss === fearsBoss ? 'fears' : 'weaknesses',
    boss: fallbackBoss,
    title: 'Boss da rimandare',
    summary: prepCampaign.length
      ? 'Hai gia una branch campagna aperta su questo fight, ma prima serve chiudere la preparazione minima.'
      : 'Prima chiudi una missione mirata: servono piu livello, gear o requisiti attivi per un pull pulito.',
    windowLabel: prepCampaign.length ? 'Campaign Prep Window' : 'Prep Window',
    windowTone: 'warning',
    tacticalReason: `Manca ancora conversione di build: oggi il boss serve piu come target da preparare che da ingaggiare.${prepCampaign.length ? ` La buona notizia e che la campagna e gia partita: ${prepCampaign[0].summary}` : ''}`,
    campaignLines: prepCampaign.slice(0, 2).map(effect => formatCampaignEffectLine(effect)),
    ctaLabel: 'Review Boss Risk',
  };
}

function getAssessmentBossReasoning(input, ans, directive, lowRecovery) {
  const reasons = [];
  const classDef = CLASS_DEFINITIONS.find(entry => entry.id === state.playerClass);

  if (!directive?.boss) {
    return ['Nessun boss utile da mostrare finché il sistema non vede un target coerente con il tuo stato e la tua progressione.'];
  }

  if (directive.kind === 'avoid') {
    if (lowRecovery) reasons.push('Recupero fragile: oggi questo boss rischia di amplificare attrito interno invece di trasformarlo in progresso.');
    if (input.hrv < 50 || input.bolt < 15) reasons.push('Segnali fisiologici bassi: meglio evitare pattern che richiedono più controllo di quello che hai disponibile oggi.');
    if (input.sleep <= 4 || input.energy <= 4) reasons.push('Sonno o energia bassi: il sistema preferisce contenimento e stabilizzazione, non confronto diretto.');
    if (directive.source === 'fears') reasons.push('Il boss è legato alle tue paure dichiarate: oggi è più utile riconoscerlo e non inseguirlo.');
    if (directive.source === 'weaknesses') reasons.push('Il boss colpisce una frattura ancora aperta della build: prima conviene rafforzare il punto debole.');
  } else {
    if (ans !== 'SYMPATHETIC' && input.energy >= 6 && input.sleep >= 6) reasons.push('Stato stabile: oggi hai abbastanza margine per trasformare il challenge in progresso reale.');
    if (directive.source === 'strengths') reasons.push('Il boss è coerente con i tuoi punti forti, quindi la build ha più probabilità di reggere il confronto.');
    if (classDef) reasons.push(`${classDef.icon} ${classDef.name} ha una finestra utile quando precisione, disciplina o tenuta sono sopra soglia.`);
    if (meetsReq(directive.boss.req)) reasons.push('I requisiti attuali sono soddisfatti: non è un target decorativo, è un fight realisticamente affrontabile.');
  }

  if (!reasons.length) reasons.push(directive.summary);
  return reasons.slice(0, 3);
}

function buildCampaignStatusModel() {
  const activeTargets = BOSS_DEFINITIONS
    .filter(boss => !state.bossesDefeated.includes(boss.id))
    .map(boss => ({
      boss,
      effects: getBossCampaignEffects(boss),
      score: getBossCampaignPriorityScore(boss, 'strengths'),
      ready: meetsReq(boss.req),
    }))
    .filter(entry => entry.effects.length > 0)
    .sort((left, right) => Number(right.ready) - Number(left.ready) || right.score - left.score || left.boss.level - right.boss.level);

  if (!activeTargets.length) {
    return {
      title: 'Campaign dormant',
      copy: 'Nessun encounter futuro è ancora stato alterato da vittorie precedenti. Il prossimo clear attiverà una nuova diramazione di campagna.',
      badge: 'BASE STATE',
      targetBoss: null,
      effectLines: [],
      ctaLabel: 'Open Boss Chamber',
    };
  }

  const primary = activeTargets[0];
  const leadingEffect = primary.effects[0] || null;
  return {
    title: `${primary.boss.icon} ${primary.boss.name}`,
    copy: `${primary.effects.length} effetti campagna sono già attivi su questo encounter.${leadingEffect ? ` Primo shift: ${leadingEffect.summary}` : ''}${primary.ready ? ' Il fight è affrontabile ora.' : ' Serve ancora preparazione prima del pull.'}`,
    badge: primary.ready ? 'CAMPAIGN LIVE' : 'CAMPAIGN LOCKED',
    targetBoss: primary.boss,
    effectLines: primary.effects.slice(0, 3).map(effect => formatCampaignEffectLine(effect)),
    ctaLabel: 'Review Campaign Boss',
  };
}

function buildTodayCommandModel() {
  const assessment = getLatestAssessment();
  const scanReady = hasTodayAssessment();
  const classDef = CLASS_DEFINITIONS.find(c => c.id === state.playerClass) || null;
  const rankInfo = getHunterRankInfo();
  const topStat = [...PRIMARY_STATS].sort((a, b) => getEffectiveStatLv(b.id) - getEffectiveStatLv(a.id))[0];
  const weakStat = [...PRIMARY_STATS].sort((a, b) => getEffectiveStatLv(a.id) - getEffectiveStatLv(b.id))[0];
  const lowRecoveryWindow = !scanReady
    || isForcedRest()
    || assessment?.ansState === 'SYMPATHETIC'
    || (assessment && (assessment.sleep <= 4 || assessment.energy <= 4));

  let missionSource = null;
  if (scanReady) missionSource = lowRecoveryWindow ? 'weaknesses' : 'strengths';
  if (scanReady && !lowRecoveryWindow && assessment?.mood <= 4 && chooseRecommendedQuest('fears')) missionSource = 'fears';

  const mission = missionSource
    ? chooseRecommendedQuest(missionSource) || chooseRecommendedQuest('strengths') || chooseRecommendedQuest('weaknesses') || chooseRecommendedQuest('fears')
    : null;
  const missionMode = getRecommendedMissionMode(assessment, mission);
  const rewardPreview = estimateQuestOutcome(mission, missionMode);
  const bossDirective = getTodayBossDirective(assessment, scanReady, lowRecoveryWindow);
  const campaign = buildCampaignStatusModel();
  const scanPanel = buildTodayScanPanel(scanReady, assessment, lowRecoveryWindow, mission, bossDirective, rewardPreview);

  const stateTitle = !scanReady
    ? 'Daily Scan Required'
    : lowRecoveryWindow
      ? 'Recovery Window Active'
      : 'Command Window Open';
  const stateCopy = !scanReady
    ? 'Il sistema non ha una lettura giornaliera valida. Prima di tutto serve un Daily Scan per sbloccare una raccomandazione affidabile.'
    : lowRecoveryWindow
      ? 'Biomarcatori e recovery suggeriscono controllo, non overload. La missione raccomandata riduce attrito e stabilizza il sistema.'
      : 'I segnali di oggi supportano una missione ad alto valore. Hai una finestra pulita per convertire energia in progressione.';
  const stateBadge = !scanReady ? 'SCAN MISSING' : lowRecoveryWindow ? 'RECOVERY' : 'READY';
  const stateTone = !scanReady || lowRecoveryWindow ? 'warning' : 'success';
  const missionReason = buildTodayMissionReason(scanReady, missionSource, assessment, mission, lowRecoveryWindow);
  const rewardExpectation = buildTodayRewardExpectation(scanReady, rewardPreview, mission);
  const missionWindowLabel = !scanReady
    ? 'Routing Offline'
    : lowRecoveryWindow
      ? 'Control Window'
      : missionSource === 'fears'
        ? 'Exposure Window'
        : mission?.type === 'SPECIAL'
          ? 'High-Value Window'
          : 'Execution Window';
  const missionStatusLabel = !scanReady
    ? 'Scan missing'
    : lowRecoveryWindow
      ? 'Recovery-first'
      : missionSource === 'fears'
        ? 'Fear target'
        : missionSource === 'strengths'
          ? 'Strength push'
          : 'Weakness repair';

  const whyRows = [
    {
      label: 'Scan Readout',
      value: assessment
        ? `HRV ${assessment.hrv}ms, BOLT ${assessment.bolt}s, Sleep ${assessment.sleep}/10, Energy ${assessment.energy}/10, Mood ${assessment.mood}/10, stato ${assessment.ansState}.`
        : 'Nessun Daily Scan registrato oggi. Il sistema sta lavorando con dati incompleti.',
    },
    {
      label: 'Mission Logic',
      value: mission ? missionReason : 'Il sistema aspetta prima una lettura giornaliera valida, poi assegna una missione con priorita reale.',
    },
    {
      label: 'Boss Logic',
      value: bossDirective.tacticalReason,
    },
    {
      label: 'Campaign Logic',
      value: campaign.targetBoss
        ? `${campaign.title}: ${campaign.effectLines[0] || campaign.copy}`
        : 'Nessuna branch attiva ancora. Il prossimo clear boss aprira una nuova conseguenza di campagna.',
    },
    {
      label: 'Progression Context',
      value: `${classDef ? `${classDef.icon} ${classDef.name}` : 'Hunter'} · Rank ${rankInfo.rank} · top stat ${topStat?.name || 'N/D'} LV.${topStat ? getEffectiveStatLv(topStat.id) : 0} · punto fragile ${weakStat?.name || 'N/D'} LV.${weakStat ? getEffectiveStatLv(weakStat.id) : 0}.`,
    },
  ];

  return {
    scanReady,
    stateTitle,
    stateCopy,
    stateBadge,
    stateTone,
    scanPanel,
    mission,
    missionMode,
    missionReason,
    missionWindowLabel,
    missionStatusLabel,
    rewardPreview,
    rewardExpectation,
    bossDirective,
    campaign,
    whyRows,
  };
}

function renderTodayCommand() {
  const root = $('todayCommand');
  if (!root) return;

  const model = buildTodayCommandModel();
  const mission = model.mission;
  const missionMode = DIFFICULTY_MODES[model.missionMode] || DIFFICULTY_MODES.medium;
  const reward = model.rewardPreview;
  const boss = model.bossDirective.boss;
  const campaign = model.campaign;
  const scanPanel = model.scanPanel;

  root.className = `today-command ${model.scanReady ? 'scan-ready' : 'scan-missing'}`;

  root.innerHTML = `
    <div class="today-command-head">
      <div>
        <div class="today-command-kicker">TACTICAL COMMAND CENTER</div>
        <h2 class="today-command-title">Today Command</h2>
        <p class="today-command-sub">${model.scanReady ? 'Lo scan di oggi sta pilotando missione, rischio boss e valore atteso del prossimo move.' : 'Finche lo scan manca, il control room resta in fallback e il sistema non apre una vera priorita giornaliera.'}</p>
      </div>
      <div class="today-command-state ${model.stateTone}">${model.stateBadge}</div>
    </div>
    <div class="today-command-grid">
      <article class="today-card today-card-state">
        <div class="today-card-label">Scan State Today</div>
        <div class="today-card-title">${escapeHtml(model.stateTitle)}</div>
        <p class="today-card-copy">${escapeHtml(model.stateCopy)}</p>
        <div class="today-scan-panel ${scanPanel.panelClass}">
          <div class="today-scan-lock">
            <span class="today-scan-lock-label">${escapeHtml(scanPanel.lockLabel)}</span>
            <strong>${escapeHtml(scanPanel.lockValue)}</strong>
          </div>
          <p class="today-scan-panel-copy">${escapeHtml(scanPanel.copy)}</p>
          <div class="today-scan-grid">
            ${scanPanel.items.map(item => `
              <div class="today-scan-item ${escapeHtml(item.tone)}">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.value)}</strong>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="today-chip-row">
          <span class="today-chip">${escapeHtml(state.playerName || 'Hunter')}</span>
          <span class="today-chip">Class Sync ${getClassLevel()}</span>
          <span class="today-chip">Streak ${state.currentStreak}</span>
          <span class="today-chip">Boss ${state.bossesDefeated.length}/${BOSS_DEFINITIONS.length}</span>
        </div>
      </article>

      <article class="today-card today-card-mission">
        <div class="today-card-label">Recommended Mission Now</div>
        <div class="today-card-title">${mission ? `${mission.icon} ${escapeHtml(mission.name)}` : 'Run Daily Scan'}</div>
        <p class="today-card-copy">${mission ? escapeHtml(mission.desc) : 'Senza scan giornaliero il sistema non puo scegliere una missione affidabile. Avvia subito la lettura dei biomarcatori.'}</p>
        <div class="today-meta-row">
          <span class="today-meta-pill ${model.scanReady ? 'success' : 'warning'}">${escapeHtml(model.missionStatusLabel)}</span>
          <span class="today-meta-pill">${mission ? `${missionMode.icon} ${missionMode.label}` : 'SCAN REQUIRED'}</span>
          <span class="today-meta-pill">${mission ? `${mission.dur} min` : 'Assessment 30 sec'}</span>
          <span class="today-meta-pill">${mission ? `${getQuestRarity(Math.max(1, mission.diff + missionMode.diffOffset))}` : 'Unlock routing'}</span>
          <span class="today-meta-pill">${escapeHtml(model.missionWindowLabel)}</span>
        </div>
        <div class="today-directive-box">
          <span class="today-directive-label">Tactical reason</span>
          <p>${escapeHtml(model.missionReason)}</p>
        </div>
        <div class="today-cta-row">
          <button class="btn-primary full-w today-primary-cta" id="todayCommandMissionCta">${mission ? 'Start Mission' : 'Run Daily Scan'}</button>
        </div>
      </article>

      <article class="today-card today-card-boss ${model.bossDirective.kind === 'avoid' ? 'is-warning' : 'is-boss-ready'}">
        <div class="today-card-label">Recommended Boss or Boss to Avoid</div>
        <div class="today-card-title">${boss ? `${boss.icon} ${escapeHtml(boss.name)}` : 'No boss target available'}</div>
        <p class="today-card-copy">${escapeHtml(model.bossDirective.summary)}</p>
        <div class="today-meta-row">
          <span class="today-meta-pill ${model.bossDirective.windowTone}">${escapeHtml(model.bossDirective.windowLabel)}</span>
          <span class="today-meta-pill">${boss ? `LV ${boss.level}` : 'No target'}</span>
          <span class="today-meta-pill">${boss && meetsReq(boss.req) ? 'Ready' : 'Prep Needed'}</span>
        </div>
        <div class="today-directive-box ${model.bossDirective.windowTone}">
          <span class="today-directive-label">Tactical reason</span>
          <p>${escapeHtml(model.bossDirective.tacticalReason)}</p>
        </div>
        ${model.bossDirective.campaignLines?.length ? `
          <div class="today-campaign-list today-campaign-compact">
            ${model.bossDirective.campaignLines.map(line => `<div class="today-campaign-row">${escapeHtml(line)}</div>`).join('')}
          </div>
        ` : ''}
        <div class="today-cta-row">
          <button class="btn-secondary full-w" id="todayCommandBossCta">${escapeHtml(model.bossDirective.ctaLabel)}</button>
        </div>
      </article>

      <article class="today-card today-card-campaign ${campaign.targetBoss ? 'is-campaign-live' : ''}">
        <div class="today-card-label">Active Campaign</div>
        <div class="today-card-title">${escapeHtml(campaign.title)}</div>
        <p class="today-card-copy">${escapeHtml(campaign.copy)}</p>
        <div class="today-meta-row">
          <span class="today-meta-pill ${campaign.targetBoss && meetsReq(campaign.targetBoss.req) ? 'success' : 'warning'}">${escapeHtml(campaign.badge)}</span>
          <span class="today-meta-pill">${campaign.targetBoss ? `LV ${campaign.targetBoss.level}` : 'Next clear unlocks chain'}</span>
        </div>
        ${campaign.effectLines.length ? `
          <div class="today-campaign-list">
            ${campaign.effectLines.map(line => `<div class="today-campaign-row">${escapeHtml(line)}</div>`).join('')}
          </div>
        ` : ''}
        <div class="today-cta-row">
          <button class="btn-secondary full-w" id="todayCommandCampaignCta">${escapeHtml(campaign.ctaLabel)}</button>
        </div>
      </article>

      <article class="today-card today-card-reward">
        <div class="today-card-label">Immediate Reward</div>
        <div class="today-directive-box ${model.scanReady ? 'success' : 'warning'}">
          <span class="today-directive-label">If you move now</span>
          <p>${escapeHtml(model.rewardExpectation)}</p>
        </div>
        <div class="today-reward-grid">
          <div class="today-reward-item">
            <span class="today-reward-name">XP Preview</span>
            <strong>${reward ? `+${reward.totalXP} XP` : 'Pending scan'}</strong>
          </div>
          <div class="today-reward-item">
            <span class="today-reward-name">Streak Effect</span>
            <strong>${reward ? `+${reward.streakPct}% active` : `Streak ${state.currentStreak}`}</strong>
          </div>
          <div class="today-reward-item">
            <span class="today-reward-name">Item Progress</span>
            <strong>${reward ? escapeHtml(reward.itemProgress) : 'Mission routing locked'}</strong>
          </div>
          <div class="today-reward-item">
            <span class="today-reward-name">Faction Gain</span>
            <strong>${reward && reward.faction ? `${reward.faction.icon} +${reward.repGain} REP` : 'Pending target'}</strong>
          </div>
        </div>
      </article>

      <article class="today-card today-card-why">
        <div class="today-card-label">Why This Is Recommended</div>
        <div class="today-why-list">
          ${model.whyRows.map(row => `
            <div class="today-why-row">
              <span class="today-why-label">${escapeHtml(row.label)}</span>
              <p>${escapeHtml(row.value)}</p>
            </div>
          `).join('')}
        </div>
      </article>
    </div>`;

  const missionBtn = $('todayCommandMissionCta');
  if (missionBtn) {
    missionBtn.addEventListener('click', () => {
      if (!model.scanReady || !mission) {
        switchScreen('assess');
        return;
      }
      questTab = getQuestTabIdForQuest(mission);
      switchScreen('quests');
      setTimeout(() => startQuestWithMode(mission.id, model.missionMode), 80);
    });
  }

  const bossBtn = $('todayCommandBossCta');
  if (bossBtn) {
    bossBtn.addEventListener('click', () => {
      switchScreen('boss');
      if (boss && model.bossDirective.kind === 'engage' && meetsReq(boss.req)) {
        setTimeout(() => startBossFight(boss), 80);
      }
    });
  }

  const campaignBtn = $('todayCommandCampaignCta');
  if (campaignBtn) {
    campaignBtn.addEventListener('click', () => {
      switchScreen('boss');
      if (campaign.targetBoss && meetsReq(campaign.targetBoss.req)) {
        setTimeout(() => startBossFight(campaign.targetBoss), 80);
      }
    });
  }
}

function getStartHereElapsedDays() {
  const startedAt = state.startHere?.startedAt;
  if (!startedAt) return 1;
  const started = new Date(startedAt);
  const now = new Date();
  started.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diff = Math.floor((now - started) / 86400000);
  return Math.max(1, diff + 1);
}

function shouldShowStartHere() {
  if (!state.onboardingDone) return false;
  const elapsed = getStartHereElapsedDays();
  const hasNoQuestHistory = (state.questsCompleted || 0) === 0;
  return hasNoQuestHistory || (elapsed <= 7 && !isStartHereFullyCompleted());
}

function isStartHereFullyCompleted() {
  return [1, 2, 3, 4, 5, 6, 7].every(day => isStartHereDayComplete(day));
}

function getStartHereBeginnerBoss() {
  return [...BOSS_DEFINITIONS]
    .filter(boss => !state.bossesDefeated.includes(boss.id))
    .sort((a, b) => a.level - b.level)[0] || BOSS_DEFINITIONS[0] || null;
}

function getStartHereRewardQuest() {
  const assessment = getLatestAssessment();
  return getAvailableQuests(assessment).find(quest => quest.type === 'SPECIAL')
    || SPECIAL_QUESTS.find(quest => !getDoneInfo(quest.id) && meetsReq(quest.req))
    || null;
}

function getStartHereWeeklyDirection() {
  const weakStat = [...PRIMARY_STATS].sort((a, b) => getEffectiveStatLv(a.id) - getEffectiveStatLv(b.id))[0];
  const path = state.startHere?.buildPath;
  if (path === 'vanguard') {
    return `Consolida il percorso Vanguard: alza ${weakStat?.name || 'la tua stat piu fragile'} e prepara un boss più pesante.`;
  }
  if (path === 'oracle') {
    return `Consolida il percorso Oracle: usa scan frequenti, precisione cognitiva e controllo prima del prossimo raid.`;
  }
  return `La prossima crescita passa da ${weakStat?.name || 'una stat prioritaria'} e da una missione che riduca attrito.`;
}

function isStartHereDayComplete(day) {
  const scanReady = hasTodayAssessment();
  const rewardUnlocked = getOwnedEquipmentItems().length > 0 || Object.values(state.materials || {}).some(value => value > 0);
  switch (day) {
    case 1:
      return state.assessmentHistory.length > 0 && (state.questsCompleted || 0) > 0;
    case 2:
      return !!state.startHere?.basicsReviewed;
    case 3:
      return state.bossesDefeated.length > 0;
    case 4:
      return rewardUnlocked;
    case 5:
      return !!state.startHere?.buildPath;
    case 6:
      return scanReady && !!state.startHere?.adaptiveReviewed;
    case 7:
      return !!state.startHere?.weeklyRecapReviewed;
    default:
      return false;
  }
}

function getStartHereUnlockedDay() {
  if ((state.questsCompleted || 0) === 0) return 1;
  return Math.min(7, getStartHereElapsedDays());
}

function getStartHereActiveDay() {
  const unlocked = getStartHereUnlockedDay();
  for (let day = 1; day <= unlocked; day += 1) {
    if (!isStartHereDayComplete(day)) return day;
  }
  return Math.min(7, unlocked + 1);
}

function getStartHereBuildChoices() {
  return [
    {
      id: 'vanguard',
      icon: '⚔',
      name: 'Vanguard Path',
      copy: 'Corpo, momentum e pressione controllata. Sblocca reward con missioni piu fisiche e boss entry più aggressive.',
    },
    {
      id: 'oracle',
      icon: '🔮',
      name: 'Oracle Path',
      copy: 'Scan, focus e adattamento. Spinge su decisioni più pulite, controllo e build neuro-tattica.',
    },
  ];
}

function getStartHereDefinition(day) {
  const assessment = getLatestAssessment();
  const todayModel = buildTodayCommandModel();
  const beginnerBoss = getStartHereBeginnerBoss();
  const rewardQuest = getStartHereRewardQuest();
  const buildChoices = getStartHereBuildChoices();
  const equippedCount = getOwnedEquipmentItems().length;
  const rewardUnlocked = equippedCount > 0 || Object.values(state.materials || {}).some(value => value > 0);

  const defs = {
    1: {
      dayLabel: 'Day 1',
      title: 'Run your first scan and clear your first mission',
      copy: 'Prima leggi il sistema. Poi esegui una sola missione. Questo basta per avviare davvero la progressione.',
      status: hasTodayAssessment()
        ? `Scan online${(state.questsCompleted || 0) > 0 ? ' · prima missione completata' : ' · missione ancora da lanciare'}`
        : 'Daily Scan mancante',
      ctaLabel: hasTodayAssessment() ? 'Start First Mission' : 'Run Daily Scan',
      preview: assessment
        ? `Ultimo scan: HRV ${assessment.hrv}ms · BOLT ${assessment.bolt}s · ${assessment.ansState}`
        : 'Il sistema non ha ancora biomarcatori validi per guidarti.',
    },
    2: {
      dayLabel: 'Day 2',
      title: 'Learn the four signals that matter',
      copy: 'Ignora tutto il resto. XP fa crescere le stat, Hunter Rank misura il profilo, Class Sync dice quanto la build è coerente, Streak moltiplica il momentum.',
      status: `XP ${state.totalXP} · Rank ${getHunterRankInfo().rank} · Class Sync ${getClassLevel()} · Streak ${state.currentStreak}`,
      ctaLabel: 'I Understand The Basics',
      preview: 'Memorizza solo queste quattro metriche. Sono la base di tutte le decisioni future.',
    },
    3: {
      dayLabel: 'Day 3',
      title: 'Enter your first beginner boss',
      copy: 'Il boss non serve a punirti. Serve a darti una prima soglia vera. Affronta il bersaglio piu accessibile e impara il ritmo del raid.',
      status: beginnerBoss ? `${beginnerBoss.icon} ${beginnerBoss.name} · ${meetsReq(beginnerBoss.req) ? 'Ready' : 'Prep Needed'}` : 'Nessun beginner boss disponibile',
      ctaLabel: beginnerBoss && meetsReq(beginnerBoss.req) ? 'Enter Beginner Boss' : 'Open Boss Chamber',
      preview: beginnerBoss ? `${beginnerBoss.title}. ${beginnerBoss.emotionLabel || 'Emotional signature attiva'}.` : 'Completa più progressione per sbloccare il primo boss.',
    },
    4: {
      dayLabel: 'Day 4',
      title: 'Unlock your first meaningful reward',
      copy: 'Da oggi la progressione deve lasciare una traccia concreta: un pezzo gear, un materiale utile, o un upgrade che cambia il tuo valore reale.',
      status: rewardUnlocked ? `Reward sbloccata · ${equippedCount} pezzi gear attivi` : rewardQuest ? `${rewardQuest.icon} ${rewardQuest.name}` : 'Reward hunt non ancora pronta',
      ctaLabel: rewardQuest ? 'Open Reward Hunt' : 'Open Armory',
      preview: rewardQuest ? `Target consigliato: ${rewardQuest.desc}` : 'Controlla gear, set e materiali già raccolti.',
    },
    5: {
      dayLabel: 'Day 5',
      title: 'Choose your build direction',
      copy: 'Non serve una build perfetta. Serve una direzione chiara. Scegli un profilo e lascia che il sistema inizi a leggerti meglio.',
      status: state.startHere?.buildPath ? `Path attiva: ${state.startHere.buildPath === 'vanguard' ? 'Vanguard' : 'Oracle'}` : 'Nessuna path selezionata',
      ctaLabel: state.startHere?.buildPath ? 'Confirm Build Direction' : 'Choose Build Direction',
      preview: 'Vanguard privilegia impatto e reward fisica. Oracle privilegia controllo, scan e adattamento.',
      choices: buildChoices,
    },
    6: {
      dayLabel: 'Day 6',
      title: 'Receive an adaptive recommendation',
      copy: 'Ora il sistema usa i tuoi dati reali per dirti cosa fare adesso, non in astratto. Devi solo leggere una raccomandazione e seguirla.',
      status: todayModel.mission ? `${todayModel.mission.icon} ${todayModel.mission.name}` : 'Recommendation bloccata finché manca lo scan',
      ctaLabel: hasTodayAssessment() ? 'Review Adaptive Command' : 'Run Daily Scan',
      preview: hasTodayAssessment() && todayModel.mission
        ? `Motivo principale: ${todayModel.stateTitle}. Reward preview ${todayModel.rewardPreview ? `+${todayModel.rewardPreview.totalXP} XP` : 'in attesa'}.`
        : 'Completa uno scan giornaliero per ricevere una raccomandazione adattiva affidabile.',
    },
    7: {
      dayLabel: 'Day 7',
      title: 'See your weekly recap and next direction',
      copy: 'Non guardare tutto. Guarda il pattern: quante missioni hai chiuso, quanta stabilità hai creato e dove devi crescere adesso.',
      status: `${state.questsCompleted} quest · ${state.bossesDefeated.length} boss · streak ${state.currentStreak}`,
      ctaLabel: 'View Weekly Recap',
      preview: getStartHereWeeklyDirection(),
      recap: {
        missions: state.questsCompleted,
        bosses: state.bossesDefeated.length,
        rank: getHunterRankInfo().rank,
        direction: getStartHereWeeklyDirection(),
      },
    },
  };

  return defs[day];
}

function renderStartHereModule() {
  const root = $('startHereModule');
  if (!root) return;
  if (!shouldShowStartHere()) {
    startHerePreviewDay = null;
    root.innerHTML = '';
    root.classList.add('hidden');
    return;
  }

  root.classList.remove('hidden');
  const unlockedDay = getStartHereUnlockedDay();
  const activeDay = getStartHereActiveDay();
  const displayDay = startHerePreviewDay && startHerePreviewDay <= unlockedDay ? startHerePreviewDay : activeDay;
  const activeDef = getStartHereDefinition(displayDay);
  const completedCount = [1, 2, 3, 4, 5, 6, 7].filter(day => isStartHereDayComplete(day)).length;
  const selectedBuild = state.startHere?.buildPath;
  const nextDay = displayDay < 7 ? getStartHereDefinition(Math.min(7, displayDay + 1)) : null;

  root.innerHTML = `
    <div class="start-here-shell">
      <div class="start-here-head">
        <div>
          <div class="start-here-kicker">FIRST 7 DAYS</div>
          <h2 class="start-here-title">Start Here</h2>
          <p class="start-here-sub">Un solo compito al giorno. Nessun muro di testo. Solo la prossima mossa giusta.</p>
        </div>
        <div class="start-here-progress-copy">${completedCount}/7 complete</div>
      </div>
      <div class="start-here-progress-bar"><span style="width:${Math.round((completedCount / 7) * 100)}%"></span></div>
      <div class="start-here-days">
        ${[1, 2, 3, 4, 5, 6, 7].map(day => {
          const complete = isStartHereDayComplete(day);
          const locked = day > unlockedDay;
          const active = day === displayDay;
          return `<button class="start-here-day ${complete ? 'done' : ''} ${locked ? 'locked' : ''} ${active ? 'active' : ''}" data-start-here-day="${day}" ${locked ? 'disabled' : ''}>
            <span class="start-here-day-num">${day}</span>
            <span class="start-here-day-state">${complete ? 'Clear' : locked ? 'Locked' : active ? 'Now' : 'Open'}</span>
          </button>`;
        }).join('')}
      </div>
      <article class="start-here-card" id="startHereCard">
        <div class="start-here-card-top">
          <div>
            <div class="start-here-card-day">${escapeHtml(activeDef.dayLabel)}</div>
            <h3 class="start-here-card-title">${escapeHtml(activeDef.title)}</h3>
          </div>
          <div class="start-here-card-status">${escapeHtml(activeDef.status)}</div>
        </div>
        <p class="start-here-card-copy">${escapeHtml(activeDef.copy)}</p>
        <div class="start-here-preview">${escapeHtml(activeDef.preview)}</div>
        ${activeDef.choices ? `
          <div class="start-here-build-grid">
            ${activeDef.choices.map(choice => `
              <button class="start-here-build ${selectedBuild === choice.id ? 'selected' : ''}" data-build-path="${choice.id}">
                <span class="start-here-build-title">${choice.icon} ${escapeHtml(choice.name)}</span>
                <span class="start-here-build-copy">${escapeHtml(choice.copy)}</span>
              </button>
            `).join('')}
          </div>
        ` : ''}
        ${activeDef.recap ? `
          <div class="start-here-recap-grid">
            <div class="start-here-recap-item"><span>Missions</span><strong>${activeDef.recap.missions}</strong></div>
            <div class="start-here-recap-item"><span>Boss</span><strong>${activeDef.recap.bosses}</strong></div>
            <div class="start-here-recap-item"><span>Rank</span><strong>${escapeHtml(activeDef.recap.rank)}</strong></div>
            <div class="start-here-recap-item wide"><span>Next Direction</span><strong>${escapeHtml(activeDef.recap.direction)}</strong></div>
          </div>
        ` : ''}
        <div class="start-here-actions">
          <button class="btn-primary full-w" id="startHereMainCta">${escapeHtml(activeDef.ctaLabel)}</button>
        </div>
        ${nextDay ? `<div class="start-here-next">Tomorrow: ${escapeHtml(nextDay.title)}</div>` : '<div class="start-here-next">Onboarding cycle complete. Ora il sistema ti guida da solo.</div>'}
      </article>
    </div>`;

  root.querySelectorAll('[data-start-here-day]').forEach(button => {
    button.addEventListener('click', () => {
      startHerePreviewDay = Number(button.dataset.startHereDay);
      renderStatus();
    });
  });

  root.querySelectorAll('[data-build-path]').forEach(button => {
    button.addEventListener('click', () => {
      state.startHere.buildPath = button.dataset.buildPath;
      saveState();
      renderStatus();
    });
  });

  const mainCta = $('startHereMainCta');
  if (!mainCta) return;
  mainCta.addEventListener('click', async () => {
    switch (displayDay) {
      case 1: {
        if (!hasTodayAssessment()) {
          switchScreen('assess');
          return;
        }
        const mission = buildTodayCommandModel().mission;
        const mode = buildTodayCommandModel().missionMode;
        if (mission) {
          questTab = getQuestTabIdForQuest(mission);
          switchScreen('quests');
          setTimeout(() => startQuestWithMode(mission.id, mode), 80);
        }
        return;
      }
      case 2:
        state.startHere.basicsReviewed = true;
        startHerePreviewDay = null;
        await saveState();
        renderStatus();
        return;
      case 3: {
        const boss = getStartHereBeginnerBoss();
        switchScreen('boss');
        if (boss && meetsReq(boss.req)) {
          setTimeout(() => startBossFight(boss), 80);
        }
        return;
      }
      case 4: {
        const rewardQuest = getStartHereRewardQuest();
        if (rewardQuest) {
          questTab = getQuestTabIdForQuest(rewardQuest);
          switchScreen('quests');
          setTimeout(() => startQuestWithMode(rewardQuest.id, getRecommendedMissionMode(getLatestAssessment(), rewardQuest)), 80);
          return;
        }
        switchScreen('gear');
        return;
      }
      case 5:
        if (!state.startHere.buildPath) return;
        startHerePreviewDay = null;
        await saveState();
        renderStatus();
        return;
      case 6:
        if (!hasTodayAssessment()) {
          switchScreen('assess');
          return;
        }
        state.startHere.adaptiveReviewed = true;
        startHerePreviewDay = null;
        await saveState();
        switchScreen('status');
        $('todayCommand')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        renderStatus();
        return;
      case 7:
        state.startHere.weeklyRecapReviewed = true;
        startHerePreviewDay = null;
        await saveState();
        renderStatus();
        return;
      default:
        break;
    }
  });
}

function getRank(diff) {
  for (const r of RANK_TABLE) { if (diff >= r.d) return r.r; }
  return 'E';
}

function calcXP(base, diff, streak, debuffPen) {
  const dm = Math.max(0.6, 1 + (diff-5)*0.1);
  const sb = Math.min(streak*0.05, 0.5);
  return Math.max(1, Math.floor(base * dm * (1+sb) * (1 - Math.min(debuffPen,0.8))));
}

function getDebuffPenalty(statId) {
  let pen = 0;
  for (const d of state.activeDebuffs) {
    const tmpl = Object.values(DEBUFF_TEMPLATES).find(t=>t.name===d.name);
    if (tmpl && tmpl.cats.includes(statId)) pen += (1 - tmpl.mult);
  }
  return Math.min(pen, 0.8);
}

function meetsReq(reqs) {
  return reqs.every(r => getEffectiveStatLv(r.stat) >= r.minLv);
}

function getOwnedEquipmentItems() {
  return (state.ownedEquipment || [])
    .map(id => EQUIPMENT_CATALOG[id])
    .filter(Boolean)
    .sort((a, b) => EQUIPMENT_SLOTS.indexOf(a.slot) - EQUIPMENT_SLOTS.indexOf(b.slot));
}

function rollLootTable(table) {
  if (!Array.isArray(table) || !table.length) return null;
  const total = table.reduce((sum, entry) => sum + (entry.weight || 0), 0);
  let roll = Math.random() * total;
  for (const entry of table) {
    roll -= entry.weight || 0;
    if (roll <= 0) return entry.itemId;
  }
  return table[table.length - 1].itemId;
}

function getQuestDropItemId(quest) {
  return rollLootTable(SPECIAL_QUEST_LOOT_TABLES[quest.id]) || quest.equipmentId || null;
}

function getQuestLootItems(quest) {
  const itemIds = (SPECIAL_QUEST_LOOT_TABLES[quest.id] || [{ itemId: quest.equipmentId, weight: 100 }])
    .map(entry => entry.itemId)
    .filter(Boolean);
  return [...new Set(itemIds)].map(itemId => EQUIPMENT_CATALOG[itemId]).filter(Boolean);
}

function getSlotBlueprintQuests(slot) {
  return SPECIAL_QUESTS.filter(quest => getQuestLootItems(quest).some(item => item.slot === slot));
}

function getStatDefinition(statId) {
  return [...PRIMARY_STATS, ...SECONDARY_STATS].find(stat => stat.id === statId) || null;
}

function getRequirementProgress(reqs=[]) {
  if (!reqs.length) return { pct: 100, missing: [], summary: 'Requisiti completati.' };
  const ratios = [];
  const missing = [];

  for (const req of reqs) {
    const current = getEffectiveStatLv(req.stat);
    const ratio = Math.max(0, Math.min(current / req.minLv, 1));
    ratios.push(ratio);
    if (current < req.minLv) {
      const stat = getStatDefinition(req.stat);
      missing.push({
        statId: req.stat,
        icon: stat?.icon || '✦',
        name: stat?.name || req.stat,
        current,
        target: req.minLv,
        gap: req.minLv - current,
      });
    }
  }

  const pct = Math.round((ratios.reduce((sum, value) => sum + value, 0) / ratios.length) * 100);
  const summary = missing.length
    ? missing.map(entry => `${entry.icon} ${entry.name} ${entry.current}/${entry.target}`).join(' · ')
    : 'Requisiti centrati. Ti manca solo completare la missione.';
  return { pct, missing, summary };
}

function getQuestUnlockSignal(quest) {
  const reqProgress = getRequirementProgress(quest.req);
  const completed = (state.specialQuestCompleted || []).includes(quest.id);
  const ready = meetsReq(quest.req);
  let pct = Math.round(reqProgress.pct * 0.92);
  if (ready) pct = 92;
  if (completed) pct = 100;
  return {
    pct,
    ready,
    completed,
    reqProgress,
  };
}

function getGearUnlockStatePriority(stateKey) {
  return {
    ready_for_drop: 4,
    close_to_unlock: 3,
    partial_chain_completed: 2,
    requirements_building: 1,
  }[stateKey] || 0;
}

function getGearUnlockProgressState(entry) {
  const best = entry.bestSource;
  const quest = findQuestById(best.questId);
  const totalReqs = Math.max(quest?.req?.length || 0, best.reqProgress.missing.length || 0, 1);
  const missingReqs = best.reqProgress.missing || [];
  const metReqs = Math.max(0, totalReqs - missingReqs.length);
  const readySources = entry.sources.filter(source => source.ready && !source.completed);
  const primaryGap = missingReqs[0] || null;
  const isCloseToUnlock = !best.ready && (!!primaryGap && missingReqs.length === 1 && primaryGap.gap <= 1 || best.pct >= 78);
  const isPartialChain = !best.ready && metReqs > 0 && missingReqs.length > 0;

  if (best.ready) {
    const multipleRoutes = readySources.length > 1;
    return {
      key: 'ready_for_drop',
      badge: 'READY FOR DROP',
      badgeClass: 'ready',
      statusLabel: multipleRoutes ? 'Protocol unlocked' : 'One mission left',
      copy: multipleRoutes
        ? `Hai ${readySources.length} rotte gia vive per cercare questo pezzo.`
        : `Requisiti centrati. Ti resta solo chiudere ${best.questIcon} ${best.questName}.`,
      progressLabel: multipleRoutes ? `${readySources.length} rotte aperte` : 'Requisiti centrati',
      showTrack: false,
      blueprintState: multipleRoutes ? 'Requirements met · protocol unlocked' : 'Requirements met · one mission left',
      slotState: multipleRoutes ? 'Protocol unlocked' : 'One mission left',
      missingLine: multipleRoutes
        ? `Hai gia piu ingressi validi: scegli la rotta migliore e vai a rollare il drop.`
        : 'Il gating stat e chiuso. Ora conta solo il clear della missione.',
    };
  }

  if (isCloseToUnlock) {
    return {
      key: 'close_to_unlock',
      badge: 'CLOSE TO UNLOCK',
      badgeClass: 'near',
      statusLabel: 'Close to unlock',
      copy: primaryGap
        ? `Ti manca solo ${primaryGap.icon} ${primaryGap.name} +${primaryGap.gap} per aprire il protocollo.`
        : 'Sei entrato nell ultimo tratto di build verso questo item.',
      progressLabel: primaryGap
        ? `Ultimo gradino: ${primaryGap.current}/${primaryGap.target}`
        : `${entry.progressPct}% di allineamento`,
      showTrack: true,
      blueprintState: 'Close to unlock',
      slotState: primaryGap ? `${primaryGap.name} +${primaryGap.gap}` : 'Quasi pronto',
      missingLine: best.reqProgress.summary,
    };
  }

  if (isPartialChain) {
    return {
      key: 'partial_chain_completed',
      badge: 'PARTIAL CHAIN',
      badgeClass: 'partial',
      statusLabel: 'Partial chain completed',
      copy: `${metReqs}/${totalReqs} requisiti sono gia stabili. Il pezzo si sta aprendo in modo credibile.`,
      progressLabel: `${metReqs}/${totalReqs} requisiti chiusi`,
      showTrack: true,
      blueprintState: `Partial chain · ${metReqs}/${totalReqs}`,
      slotState: `${metReqs}/${totalReqs} requisiti`,
      missingLine: best.reqProgress.summary,
    };
  }

  return {
    key: 'requirements_building',
    badge: 'BUILD IN PROGRESS',
    badgeClass: 'build',
    statusLabel: 'Requirements building',
    copy: 'Il blueprint e tracciato, ma la build deve ancora agganciare i gate giusti.',
    progressLabel: entry.progressPct >= 40 ? `${entry.progressPct}% di allineamento` : 'Rotta tracciata',
    showTrack: entry.progressPct >= 40,
    blueprintState: 'Blueprint traced',
    slotState: 'Blueprint traced',
    missingLine: best.reqProgress.summary,
  };
}

function getMissingUpgradeMaterials(costs) {
  return Object.entries(costs || {}).reduce((list, [materialId, amount]) => {
    const ownedAmount = state.materials?.[materialId] || 0;
    if (ownedAmount >= amount) return list;
    const material = MATERIAL_CATALOG[materialId] || null;
    list.push({
      materialId,
      icon: material?.icon || '✦',
      name: material?.name || materialId,
      needed: amount,
      owned: ownedAmount,
      gap: amount - ownedAmount,
    });
    return list;
  }, []);
}

function getGearForgeState(item) {
  const upgrade = getUpgradeCost(item);
  if (!upgrade) {
    return {
      key: 'maxed',
      label: 'Forge maxed',
      tone: 'max',
      hint: 'Potenziamento massimo raggiunto. Questo pezzo e gia al cap attuale.',
    };
  }

  const missing = getMissingUpgradeMaterials(upgrade.costs);
  if (!missing.length) {
    return {
      key: 'ready',
      label: 'Forge ready',
      tone: 'ready',
      hint: 'Materiali completi. Puoi salire subito al prossimo tier.',
    };
  }

  if (missing.length === 1 && missing[0].materialId === 'BOSS_CORE') {
    return {
      key: 'boss_material_missing',
      label: 'Boss material missing',
      tone: 'boss',
      hint: `Ti manca ${missing[0].gap} ${missing[0].icon} ${missing[0].name} per il prossimo step di forge.`,
    };
  }

  if (missing.length === 1) {
    return {
      key: 'one_material_left',
      label: 'One material run left',
      tone: 'near',
      hint: `Ti manca ${missing[0].gap} ${missing[0].icon} ${missing[0].name} per chiudere il costo.`,
    };
  }

  return {
    key: 'split_materials',
    label: 'Materials split',
    tone: 'split',
    hint: missing.map(entry => `${entry.icon} ${entry.name} ${entry.owned}/${entry.needed}`).join(' · '),
  };
}

function getItemUnlockPreviewEntries(limit = 3) {
  const owned = new Set(state.ownedEquipment || []);
  const itemMap = new Map();

  SPECIAL_QUESTS.forEach(quest => {
    const signal = getQuestUnlockSignal(quest);
    getQuestLootItems(quest).forEach(item => {
      if (!item || owned.has(item.id)) return;
      const existing = itemMap.get(item.id);
      const source = {
        type: 'mission',
        questId: quest.id,
        questName: quest.name,
        questIcon: quest.icon,
        diff: quest.diff,
        pct: signal.pct,
        ready: signal.ready,
        completed: signal.completed,
        reqProgress: signal.reqProgress,
      };
      if (!existing) {
        itemMap.set(item.id, {
          item,
          slot: item.slot,
          sources: [source],
        });
        return;
      }
      existing.sources.push(source);
    });
  });

  return [...itemMap.values()]
    .map(entry => {
      const sortedSources = entry.sources.sort((left, right) => Number(left.completed) - Number(right.completed)
        || Number(right.ready) - Number(left.ready)
        || right.pct - left.pct
        || left.questName.localeCompare(right.questName));
      const bestSource = sortedSources[0];
      const sourceMissions = sortedSources.map(source => `${source.questIcon} ${source.questName}`);
      const progressState = getGearUnlockProgressState({ ...entry, bestSource, sources: sortedSources });
      return {
        ...entry,
        bestSource,
        progressPct: bestSource.pct,
        nearUnlock: progressState.key === 'ready_for_drop' || progressState.key === 'close_to_unlock',
        progressState,
        sourceMissions,
        missingSummary: bestSource.reqProgress.summary,
      };
    })
    .sort((left, right) => getGearUnlockStatePriority(right.progressState?.key) - getGearUnlockStatePriority(left.progressState?.key)
      || right.progressPct - left.progressPct
      || EQUIPMENT_SLOTS.indexOf(left.slot) - EQUIPMENT_SLOTS.indexOf(right.slot))
    .slice(0, limit);
}

function getSlotUnlockPreview(slot, previewEntries) {
  return previewEntries.find(entry => entry.slot === slot) || null;
}

function renderArmorySourceLine(entry, mode = 'default') {
  const best = entry?.bestSource;
  if (!best) return '';
  const label = best.ready
    ? mode === 'compact' ? 'Run pronto ora' : 'Missione pronta'
    : mode === 'compact' ? 'Rotta chiave' : 'Sblocca con questa missione';
  const alternatives = (entry.sources?.length || 0) > 1
    ? ` · +${entry.sources.length - 1} altre rotte`
    : '';
  return `<div class="gear-source-line">${label}: <strong>${best.questIcon} ${escapeHtml(best.questName)}</strong>${alternatives}</div>`;
}

function openQuestBoardFromArmory(questId) {
  const quest = findQuestById(questId);
  if (!quest) return;
  questTab = getQuestTabIdForQuest(quest);
  pendingQuestBoardFocus = { questId };
  switchScreen('quests');
}

function applyPendingQuestBoardFocus() {
  if (!pendingQuestBoardFocus || currentScreen !== 'quests') return;
  const card = document.querySelector(`.quest-card[data-quest-id="${pendingQuestBoardFocus.questId}"]`);
  if (!card) return;
  setQuestLayerOpen(`detail-${pendingQuestBoardFocus.questId}`, true);
  card.classList.add('armory-focus');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => card.classList.remove('armory-focus'), 2200);
  pendingQuestBoardFocus = null;
}

function renderGearUnlockFeature(entry) {
  if (!entry) {
    return '<div class="gear-empty-state">Nessun nuovo unlock imminente rilevato. Continua con special quest e boss per aprire nuovi blueprint.</div>';
  }
  const best = entry.bestSource;
  const stateLabel = entry.progressState;

  return `
    <article class="gear-unlock-feature-card gear-linked-preview ${entry.nearUnlock ? 'near-unlock' : ''}" data-armory-quest-id="${best.questId}" tabindex="0" role="button" aria-label="Apri la missione ${escapeHtml(best.questName)} nel Quest Board">
      <div class="gear-unlock-feature-head">
        <div>
          <div class="gear-unlock-kicker">CLOSEST RELIC</div>
          <h2 class="gear-unlock-feature-title">${entry.item.icon} ${escapeHtml(entry.item.name)}</h2>
          <p class="gear-unlock-feature-copy">${escapeHtml(stateLabel.copy)}</p>
        </div>
        <div class="gear-unlock-badge ${stateLabel.badgeClass}">${stateLabel.badge}</div>
      </div>
      ${stateLabel.showTrack ? `<div class="gear-unlock-track"><span style="width:${entry.progressPct}%"></span></div>` : ''}
      <div class="gear-unlock-meta-row">
        <span>${escapeHtml(EQUIPMENT_SLOT_LABELS[entry.item.slot])} · ${escapeHtml(entry.item.rarity)}</span>
        <span>${escapeHtml(stateLabel.statusLabel)}</span>
      </div>
      ${renderArmorySourceLine(entry)}
      ${stateLabel.progressLabel ? `<div class="gear-unlock-feature-status">${escapeHtml(stateLabel.progressLabel)}</div>` : ''}
      <div class="gear-unlock-feature-missing">${escapeHtml(stateLabel.missingLine)}</div>
    </article>`;
}

function grantSetUpgrade(setId, bonuses, sourceLabel='Boss Reward') {
  if (!setId || !bonuses) return;
  if (!state.setUpgrades) state.setUpgrades = {};
  const current = state.setUpgrades[setId] || {};
  for (const [statId, amount] of Object.entries(bonuses)) {
    current[statId] = (current[statId] || 0) + amount;
  }
  state.setUpgrades[setId] = current;
  showToast(`✦ Upgrade set ${EQUIPMENT_SET_BONUSES[setId]?.name || setId}`, 'levelup');
  showSystemPopup({
    tone: 'reward',
    badge: 'SET UPGRADE',
    title: 'SET POTENZIATO',
    body: `${sourceLabel}: ${EQUIPMENT_SET_BONUSES[setId]?.name || setId} ora concede ${Object.entries(bonuses).map(([stat, amount]) => `+${amount} ${stat}`).join(' · ')} extra quando indossi il set.`,
    sound: 'reward',
  });
}

function getSetUpgradeBonusForStat(statId) {
  return Object.values(state.setUpgrades || {}).reduce((sum, upgrade) => sum + (upgrade?.[statId] || 0), 0);
}

function getItemUpgradeLevel(itemId) {
  return Math.max(0, Math.min(UPGRADE_MAX_LEVEL, state.equipmentUpgrades?.[itemId] || 0));
}

function getItemBonuses(item) {
  if (!item) return {};
  const upgradeLevel = getItemUpgradeLevel(item.id);
  return Object.fromEntries(Object.entries(item.bonuses || {}).map(([statId, amount]) => [statId, amount + upgradeLevel]));
}

function getItemDisplayName(item) {
  if (!item) return '';
  const upgradeLevel = getItemUpgradeLevel(item.id);
  return upgradeLevel > 0 ? `${item.name} +${upgradeLevel}` : item.name;
}

function getUpgradeCost(item) {
  const currentLevel = getItemUpgradeLevel(item.id);
  if (currentLevel >= UPGRADE_MAX_LEVEL) return null;
  const rarityBase = UPGRADE_RARITY_BASE[item.rarity] || UPGRADE_RARITY_BASE.RARE;
  const nextLevel = currentLevel + 1;
  const mainMaterial = SET_PRIMARY_MATERIAL[item.set] || 'IRON_ORE';
  return {
    nextLevel,
    costs: {
      [mainMaterial]: rarityBase.main + currentLevel * 2,
      BOSS_CORE: rarityBase.core + Math.max(0, currentLevel),
    },
  };
}

function hasUpgradeMaterials(costs) {
  return Object.entries(costs || {}).every(([materialId, amount]) => (state.materials?.[materialId] || 0) >= amount);
}

function formatMaterialCost(costs) {
  return Object.entries(costs || {})
    .filter(([, amount]) => amount > 0)
    .map(([materialId, amount]) => `${MATERIAL_CATALOG[materialId]?.icon || '✦'} ${amount}`)
    .join(' · ');
}

function awardMaterial(materialId, amount=1, sourceLabel='loot') {
  if (!MATERIAL_CATALOG[materialId]) return;
  if (!state.materials) state.materials = {};
  state.materials[materialId] = (state.materials[materialId] || 0) + amount;
  showToast(`${MATERIAL_CATALOG[materialId].icon} +${amount} ${MATERIAL_CATALOG[materialId].name}`, 'xp');
}

function spendMaterials(costs) {
  for (const [materialId, amount] of Object.entries(costs || {})) {
    state.materials[materialId] = Math.max(0, (state.materials[materialId] || 0) - amount);
  }
}

function upgradeEquipmentItem(itemId) {
  const item = EQUIPMENT_CATALOG[itemId];
  if (!item) return;
  const upgrade = getUpgradeCost(item);
  if (!upgrade) {
    showToast('Pezzo gia al massimo', 'alert');
    return;
  }
  if (!hasUpgradeMaterials(upgrade.costs)) {
    showToast('Materiali insufficienti per la forge', 'alert');
    return;
  }
  spendMaterials(upgrade.costs);
  if (!state.equipmentUpgrades) state.equipmentUpgrades = {};
  state.equipmentUpgrades[itemId] = upgrade.nextLevel;
  saveState();
  renderGear();
  renderStatus();
  showSystemPopup({
    tone: 'reward',
    badge: 'FORGE',
    title: `${item.name} +${upgrade.nextLevel}`,
    body: `Forge completata. Le statistiche del pezzo sono aumentate e il loadout e gia stato ricalcolato.`,
    sound: 'reward',
  });
}

function isFlaskItem(itemId) {
  return !!FLASK_EFFECTS[itemId];
}

function getFlaskCooldownRemaining(itemId) {
  const until = state.flaskCooldowns?.[itemId] || 0;
  return Math.max(0, until - Date.now());
}

function useFlask(itemId) {
  const effect = FLASK_EFFECTS[itemId];
  if (!effect) return;
  if (getFlaskCooldownRemaining(itemId) > 0) {
    showToast(`${effect.icon} Flask in cooldown`, 'alert');
    return;
  }
  if (!state.flaskCooldowns) state.flaskCooldowns = {};
  state.flaskCooldowns[itemId] = Date.now() + effect.cooldownMs;
  addBuff(effect.buffId);
  saveState();
  renderGear();
  showSystemPopup({
    tone: 'reward',
    badge: 'FLASK',
    title: `${effect.name} ATTIVATO`,
    body: `Cooldown avviato. Effetto consumabile applicato al sistema e pronto a influenzare il prossimo run.`,
    sound: 'reward',
  });
}

function getEquippedItem(slot) {
  const itemId = state.equippedGear?.[slot];
  return itemId ? EQUIPMENT_CATALOG[itemId] : null;
}

function equipItem(itemId) {
  const item = EQUIPMENT_CATALOG[itemId];
  if (!item) return;
  if (!state.ownedEquipment?.includes(itemId)) return;
  if (!state.equippedGear) state.equippedGear = createEmptyGearSlots();
  state.equippedGear[item.slot] = itemId;
  saveState();
  renderGear();
  renderStatus();
  showToast(`${item.icon} ${item.name} equipaggiato`, 'success');
}

function unequipItem(slot) {
  if (!state.equippedGear?.[slot]) return;
  state.equippedGear[slot] = null;
  saveState();
  renderGear();
  renderStatus();
}

function awardEquipment(itemId) {
  const item = EQUIPMENT_CATALOG[itemId];
  if (!item) return;
  if (!state.ownedEquipment) state.ownedEquipment = [];
  if (state.ownedEquipment.includes(itemId)) {
    if (item.set) grantSetUpgrade(item.set, Object.fromEntries(Object.keys(item.bonuses).slice(0,1).map(statId => [statId, 1])), item.name);
    return;
  }
  state.ownedEquipment.push(itemId);
  if (!state.equippedGear) state.equippedGear = createEmptyGearSlots();
  if (!state.equippedGear[item.slot]) state.equippedGear[item.slot] = itemId;
  showToast(`${item.icon} Equip ottenuto: ${item.name}`, 'levelup');
  showSystemPopup({
    tone: 'reward',
    badge: 'GEAR',
    title: 'RELIQUIA ACQUISITA',
    body: `${item.name} agganciato al loadout. Bonus attivi: ${Object.entries(item.bonuses).map(([stat,val]) => `+${val} ${stat}`).join(' · ')}. Controlla l'Armory per slot, set e stat aggiunte.`,
    sound: 'reward',
  });
  if (currentScreen === 'gear') renderGear();
}

// ========================
// RARITY, CRITS, COMBOS, ACHIEVEMENTS, BUFFS, FACTIONS
// ========================

function getQuestRarity(diff) {
  if (diff >= 9) return 'LEGENDARY';
  if (diff >= 7) return 'EPIC';
  if (diff >= 4) return 'RARE';
  return 'COMMON';
}
const RARITY_MULT = { COMMON:1, RARE:1.3, EPIC:1.6, LEGENDARY:2.0 };
const RARITY_COLORS = { COMMON:'#8888AA', RARE:'#33BBFF', EPIC:'#9050FF', LEGENDARY:'#FFD700' };
const RARITY_LABELS = { COMMON:'Comune', RARE:'Rara', EPIC:'Epica', LEGENDARY:'Leggendaria' };

function rollCritical() {
  let chance = 0.10;
  for (const b of getActiveBuffs()) {
    const t = BUFF_CATALOG[b.buffId];
    if (t?.effect === 'critBoost') chance *= t.value;
  }
  return Math.random() < chance;
}

function getActiveBuffs() {
  const now = Date.now();
  return (state.inventory || []).filter(b => {
    const t = BUFF_CATALOG[b.buffId]; if (!t) return false;
    if (t.durType === 'time') return (b.activatedAt + t.dur) > now;
    if (t.durType === 'quest') return b.usesLeft > 0;
    return false;
  });
}

function cleanExpiredBuffs() {
  const now = Date.now();
  state.inventory = (state.inventory || []).filter(b => {
    const t = BUFF_CATALOG[b.buffId]; if (!t) return false;
    if (t.durType === 'time') return (b.activatedAt + t.dur) > now;
    if (t.durType === 'quest') return b.usesLeft > 0;
    return false;
  });
}

function addBuff(buffId) {
  const t = BUFF_CATALOG[buffId]; if (!t) return;
  if (t.durType === 'instant') {
    if (t.effect === 'instantXP') {
      const all = [...PRIMARY_STATS, ...SECONDARY_STATS];
      const rnd = all[Math.floor(Math.random() * all.length)];
      addStatXP(rnd.id, t.value);
      showToast(`${t.icon} +${t.value} XP a ${rnd.name}!`, 'xp');
    }
    return;
  }
  const buff = { buffId, activatedAt: Date.now() };
  if (t.durType === 'quest') buff.usesLeft = t.dur;
  if (!state.inventory) state.inventory = [];
  state.inventory.push(buff);
  showToast(`${t.icon} ${t.name} ottenuto!`, 'levelup');
  saveState();
}

function getBuffXPMult() {
  let m = 1;
  for (const b of getActiveBuffs()) { const t = BUFF_CATALOG[b.buffId]; if (t?.effect==='xpMult') m *= t.value; }
  return m;
}

function getBuffBonusXP(statId) {
  let bonus = 0;
  for (const b of getActiveBuffs()) {
    const t = BUFF_CATALOG[b.buffId];
    if (t?.effect==='bonusStat' && t.stat===statId) bonus += t.value;
    if (t?.effect==='bonusMulti' && t.stats?.includes(statId)) bonus += t.value;
  }
  return bonus;
}

function consumeQuestBuff() {
  for (const b of (state.inventory||[])) {
    const t = BUFF_CATALOG[b.buffId];
    if (t?.durType==='quest' && b.usesLeft > 0) b.usesLeft--;
  }
  cleanExpiredBuffs();
}

function checkCombos() {
  const done = state.todayCompleted || [];
  const triggered = state.todayCombos || [];
  for (const combo of COMBO_DEFINITIONS) {
    if (triggered.includes(combo.id)) continue;
    if (combo.check(done)) { triggerCombo(combo); }
  }
}

function triggerCombo(combo) {
  if (!state.todayCombos) state.todayCombos = [];
  state.todayCombos.push(combo.id);
  state.totalCombos = (state.totalCombos || 0) + 1;
  addStatXP(combo.bonusStat, combo.bonusXP);
  state.totalXP += combo.bonusXP;
  showToast(`🔗 COMBO: ${combo.name}`, 'levelup');
  showToast(`+${combo.bonusXP} XP bonus`, 'xp');
  if (Math.random() < 0.4) {
    const keys = ['XP_CRYSTAL','FOCUS_SHARD','IRON_HEART','LUCKY_CHARM','STAT_CRYSTAL'];
    addBuff(keys[Math.floor(Math.random() * keys.length)]);
  }
  saveState();
}

function addFactionRep(cat, amount) {
  if (!state.factionRep) state.factionRep = { PHYSIQUE:0, COGNITIVE:0, NEURAL:0, SOCIAL:0 };
  if (state.factionRep[cat] !== undefined) state.factionRep[cat] += amount;
}

function getFactionRank(cat) {
  const rep = state.factionRep?.[cat] ?? 0;
  let rank = FACTION_RANKS[0];
  for (const r of FACTION_RANKS) { if (rep >= r.rep) rank = r; }
  return rank;
}

function getFactionMult(cat) { return getFactionRank(cat).mult; }

function checkAchievements() {
  if (!state.achievements) state.achievements = [];
  for (const ach of ACHIEVEMENT_DEFINITIONS) {
    if (state.achievements.includes(ach.id)) continue;
    if (ach.check(state)) {
      state.achievements.push(ach.id);
      showToast(`🏆 ${ach.name}`, 'levelup');
      showToast(ach.desc, 'success');
      if (Math.random() < 0.6) {
        addBuff(['XP_CRYSTAL','STAT_CRYSTAL','LUCKY_CHARM'][Math.floor(Math.random()*3)]);
      }
    }
  }
  saveState();
}

function getChainProgress(chainId) {
  if (!state.chainProgress) state.chainProgress = {};
  if (!state.chainProgress[chainId]) state.chainProgress[chainId] = { step:0, completed:false };
  return state.chainProgress[chainId];
}

function advanceChain(chainId) {
  const chain = CHAIN_DEFINITIONS.find(c=>c.id===chainId); if (!chain) return;
  const p = getChainProgress(chainId); if (p.completed) return;
  p.step++;
  if (p.step >= chain.steps.length) {
    p.completed = true;
    let xp = 0;
    for (const r of chain.completionRewards) { addStatXP(r.stat, r.xp); xp += r.xp; }
    state.totalXP += xp;
    showToast(`⛓️ CATENA: ${chain.name} COMPLETATA!`, 'levelup');
    showToast(`+${xp} XP bonus!`, 'xp');
    if (chain.completionBuff) addBuff(chain.completionBuff);
  }
  saveState();
}

function checkChainAdvance(questId) {
  for (const chain of CHAIN_DEFINITIONS) {
    const p = getChainProgress(chain.id); if (p.completed) continue;
    const step = chain.steps[p.step];
    if (step && step.questId === questId) advanceChain(chain.id);
  }
}

function getWeekNumber() {
  const d = new Date(), s = new Date(d.getFullYear(),0,1);
  return Math.ceil(((d-s)/86400000 + s.getDay()+1)/7);
}

function resetWeeklyIfNeeded() {
  const w = getWeekNumber();
  if (state.lastWeeklyReset !== w) {
    state.weeklyCompleted = []; state.lastWeeklyReset = w; saveState();
  }
}

function checkWeeklyCompletion(wq) {
  if (wq.subQuests?.length > 0) return wq.subQuests.every(sq => state.todayCompleted.includes(sq));
  if (wq.id === 'w_full_spectrum') {
    const cats = new Set(state.todayCompleted.map(id => findQuestById(id)?.cat).filter(Boolean));
    return cats.has('PHYSIQUE') && cats.has('COGNITIVE') && cats.has('NEURAL') && cats.has('SOCIAL');
  }
  return false;
}

function getDailyBonus() {
  const d = new Date();
  const seed = d.getFullYear()*1000 + d.getMonth()*32 + d.getDate();
  const qi = seed % QUEST_DEFINITIONS.length;
  const bonuses = ['2X_XP','LOOT_DROP','CRIT_BOOST'];
  return { questId: QUEST_DEFINITIONS[qi].id, bonus: bonuses[seed % bonuses.length] };
}

// ========================
// CLASS SYSTEM
// ========================

function determineClass(stats) {
  let best = null, bestScore = -1;
  for (const cl of CLASS_DEFINITIONS) {
    let score = 0;
    for (const pid of cl.primary) {
      const val = stats[pid] ?? 1;
      score += val;
    }
    if (score > bestScore) { bestScore = score; best = cl; }
  }
  return best;
}

function getClassLevel() {
  if (!state.playerClass) return 1;
  const cl = CLASS_DEFINITIONS.find(c=>c.id===state.playerClass);
  if (!cl) return 1;
  const primaryAvg = cl.primary.reduce((sum, pid) => sum + getStatLv(pid), 0) / cl.primary.length;
  const supportStats = SECONDARY_STATS.filter(s => s.derivedFrom.some(d => cl.primary.includes(d)));
  const supportAvg = supportStats.length
    ? supportStats.reduce((sum, stat) => sum + getStatLv(stat.id), 0) / supportStats.length
    : 1;
  return Math.max(1, Math.round(primaryAvg * 0.7 + supportAvg * 0.35));
}

// ========================
// ASSESSMENT ENGINE
// ========================

function determineANS(input) {
  const hrvN = Math.min(input.hrv/100, 1.5);
  const moodN = input.mood/10;
  const energyN = input.energy/10;
  const sleepN = input.sleep/10;
  const boltN = Math.min(input.bolt/40, 1.0);
  const pi = hrvN*0.4 + moodN*0.15 + sleepN*0.2 + boltN*0.15 + (1-energyN)*0.1;
  if (pi >= 0.7) return 'PARASYMPATHETIC';
  if (pi >= 0.4) return 'BALANCED';
  return 'SYMPATHETIC';
}

function detectDebuffs(input, ans) {
  const d = [];
  if (input.hrv < 50 && input.mood <= 4 && ans === 'SYMPATHETIC')
    d.push({...DEBUFF_TEMPLATES.ANXIETY, id:'anxiety'});
  if (input.energy <= 3 && input.mood <= 5)
    d.push({...DEBUFF_TEMPLATES.LETHARGY, id:'lethargy'});
  if (ans === 'SYMPATHETIC' && input.hrv < 40)
    d.push({...DEBUFF_TEMPLATES.SYMPATHETIC, id:'sympathetic'});
  if (input.sleep <= 3)
    d.push({...DEBUFF_TEMPLATES.SLEEP_DEBT, id:'sleep'});
  if (input.bolt < 15)
    d.push({...DEBUFF_TEMPLATES.RESPIRATORY, id:'respiratory'});
  return d;
}

function interpretHRV(v) {
  const h = state.assessmentHistory.slice(-7);
  if (h.length < 2) return 'Baseline non ancora stabilita.';
  const avg = h.reduce((a,x)=>a+x.hrv,0)/h.length;
  const r = v/avg;
  if (r>=1.1) return 'ECCELLENTE — Performance window aperta.';
  if (r>=0.9) return 'NOMINALE — Tutte le Quest autorizzate.';
  if (r>=0.7) return 'SUB-OTTIMALE — Ridurre intensità.';
  return 'CRITICO — Solo Recovery autorizzato.';
}
function interpretBOLT(b) {
  if (b>=40) return 'ECCELLENTE — Tolleranza CO2 avanzata.';
  if (b>=25) return 'BUONO — Chemocettori in calibrazione.';
  if (b>=15) return 'INSUFFICIENTE — Priorità: protocolli respiratori.';
  return 'CRITICO — Intervento respiratorio urgente.';
}
function interpretANS(a) {
  if (a==='SYMPATHETIC') return 'ALLERTA — Priorità: vagal brake.';
  if (a==='BALANCED') return 'EQUILIBRATO — Challenge autorizzate.';
  return 'RIPOSO — Ideale per compiti cognitivi.';
}

function getAssessmentHrvBaseline() {
  const history = state.assessmentHistory.slice(-8, -1);
  if (!history.length) return null;
  return history.reduce((sum, entry) => sum + entry.hrv, 0) / history.length;
}

function getAssessmentSystemStateLabel(input, ans, lowRecovery) {
  if (lowRecovery) return 'Recovery Limited';
  if (ans === 'SYMPATHETIC') return 'High Alert';
  if (ans === 'PARASYMPATHETIC') return 'Calm Precision';
  if (input.energy >= 7 && input.sleep >= 7) return 'Performance Ready';
  return 'Stable and Usable';
}

function getAssessmentMissionTypeLabel(quest) {
  if (!quest) return 'Recovery micro-mission';
  if (quest.type === 'RECOVERY') return 'Recovery mission';
  if (quest.type === 'SPECIAL') return 'Adaptive challenge mission';
  return `${quest.cat.charAt(0)}${quest.cat.slice(1).toLowerCase()} mission`;
}

function getAssessmentRecommendationReasoning(input, ans, quest, intensity, lowRecovery) {
  const reasons = [];
  const hrvBaseline = getAssessmentHrvBaseline();

  if (lowRecovery) reasons.push('Recupero basso: il sistema protegge carico e durata.');
  if (ans === 'SYMPATHETIC') reasons.push('Sei in allerta: meglio una missione più semplice e controllabile.');
  if (input.sleep <= 4) reasons.push('Sonno basso: oggi conviene ridurre attrito e intensità.');
  if (input.energy <= 4) reasons.push('Energia bassa: serve una missione che puoi chiudere senza sprecare risorse.');
  if (input.mood <= 4 && !lowRecovery) reasons.push('Mood basso: la raccomandazione punta a darti una vittoria rapida e chiara.');
  if (input.bolt < 15) reasons.push('Controllo respiratorio fragile: meglio evitare un carico troppo aggressivo.');
  if (input.energy >= 7 && input.sleep >= 7 && ans !== 'SYMPATHETIC') reasons.push('Energia e sonno sono buoni: puoi tollerare una sfida più densa.');
  if (hrvBaseline && input.hrv >= hrvBaseline * 1.05) reasons.push('HRV sopra il tuo recente standard: finestra di recupero favorevole.');
  if (!reasons.length && quest) reasons.push(`La missione scelta è coerente con il tuo stato ${ans.toLowerCase()} e con il carico ${DIFFICULTY_MODES[intensity].label.toLowerCase()}.`);

  return reasons.slice(0, 3);
}

function buildAssessmentSummary(input, ans, debuffs) {
  const assessment = { ...input, ansState: ans };
  const lowRecovery = isForcedRest()
    || ans === 'SYMPATHETIC'
    || input.sleep <= 4
    || input.energy <= 4
    || input.bolt < 15;
  let source = 'weaknesses';

  if (lowRecovery) source = 'weaknesses';
  else if (input.mood <= 4) source = 'fears';
  else if (input.energy >= 7 && input.sleep >= 7 && ans !== 'SYMPATHETIC') source = 'strengths';

  const mission = chooseRecommendedQuest(source)
    || getAvailableQuests(assessment).find(quest => !getDoneInfo(quest.id))
    || getAvailableQuests(assessment)[0]
    || null;
  const intensity = getRecommendedMissionMode(assessment, mission);
  const intensityInfo = DIFFICULTY_MODES[intensity] || DIFFICULTY_MODES.medium;
  const outcome = estimateQuestOutcome(mission, intensity);
  const why = getAssessmentRecommendationReasoning(input, ans, mission, intensity, lowRecovery);
  const bossDirective = getTodayBossDirective(assessment, true, lowRecovery);
  const bossWhy = getAssessmentBossReasoning(input, ans, bossDirective, lowRecovery);

  return {
    systemState: getAssessmentSystemStateLabel(input, ans, lowRecovery),
    mission,
    missionType: getAssessmentMissionTypeLabel(mission),
    intensity,
    intensityInfo,
    lowRecovery,
    riskWarning: lowRecovery
      ? 'Recupero basso rilevato. Oggi la priorità è evitare overload, ridurre attrito e chiudere una missione sostenibile.'
      : '',
    why,
    explanation: why.join(' '),
    outcome,
    bossDirective,
    bossWhy,
    primarySignal: source,
    debuffCount: debuffs.length,
  };
}

function isForcedRest() {
  const h = state.assessmentHistory.slice(-7);
  if (h.length<3) return false;
  const avg = h.reduce((a,x)=>a+x.hrv,0)/h.length;
  const last = state.assessmentHistory[state.assessmentHistory.length-1];
  return last && last.hrv < avg*0.7;
}

// ========================
// QUEST LOGIC
// ========================

function getAvailableQuests(assessment) {
  const allQuests = [
    ...QUEST_DEFINITIONS,
    ...SPECIAL_QUESTS.filter(q => !(state.specialQuestCompleted || []).includes(q.id)),
    ...(state.customQuests || []),
  ];
  const rest = isForcedRest();
  if (rest) return allQuests.filter(q=>q.type==='RECOVERY');
  return allQuests.filter(q => {
    if (!meetsReq(q.req)) return false;
    if (assessment?.ansState==='SYMPATHETIC' && q.cat==='PHYSIQUE' && q.diff>6) return false;
    return true;
  }).sort((a,b)=>{
    let pa=a.diff, pb=b.diff;
    if (a.type==='RECOVERY') pa-=30;
    if (b.type==='RECOVERY') pb-=30;
    return pa-pb;
  });
}

// ========================
// COMPANION AI  (OpenRouter-powered with local fallback)
// ========================

const AI_MODEL = 'google/gemini-2.0-flash-001';

function getAiApiKey() {
  return localStorage.getItem('neuro_ai_key') || '';
}

function setAiApiKey(key) {
  localStorage.setItem('neuro_ai_key', key);
}

function getAiModel() {
  return localStorage.getItem('neuro_ai_model') || AI_MODEL;
}

function setAiModel(model) {
  localStorage.setItem('neuro_ai_model', model);
}

function buildSystemPrompt() {
  const cls = CLASS_DEFINITIONS.find(c => c.id === state.playerClass);
  const clsName = cls?.name ?? 'Hunter';
  const lv = getTotalLevel();
  const classSync = getClassLevel();
  const streak = state.currentStreak;
  const lastA = state.assessmentHistory[state.assessmentHistory.length - 1];
  const debuffs = state.activeDebuffs || [];
  const topStats = [...PRIMARY_STATS].sort((a, b) => getStatLv(b.id) - getStatLv(a.id)).slice(0, 3);
  const weakStat = [...PRIMARY_STATS].sort((a, b) => getStatLv(a.id) - getStatLv(b.id))[0];
  const todayDone = (state.todayCompleted || []).length;
  const totalQuests = state.questsCompleted || 0;
  const bossesDefeated = (state.bossesDefeated || []).length;
  const guideSnapshot = getGuideSituationalSnapshot();
  const contextNotes = {
    status: `Pagina attiva: STATUS. Today Command: ${guideSnapshot.todayModel.stateTitle}. Missione: ${guideSnapshot.todayModel.mission ? `${guideSnapshot.todayModel.mission.icon} ${guideSnapshot.todayModel.mission.name}` : 'nessuna'} . Boss verdict: ${guideSnapshot.todayModel.bossDirective.windowLabel}. Campagna: ${guideSnapshot.todayModel.campaign?.targetBoss ? `${guideSnapshot.todayModel.campaign.title} / ${guideSnapshot.todayModel.campaign.effectLines[0] || guideSnapshot.todayModel.campaign.copy}` : 'nessuna branch attiva'}.`,
    profile: `Pagina attiva: PROFILE. Classe: ${guideSnapshot.classDef ? `${guideSnapshot.classDef.icon} ${guideSnapshot.classDef.name}` : 'non assegnata'}. Top stat: ${guideSnapshot.topStat ? `${guideSnapshot.topStat.name} LV.${getEffectiveStatLv(guideSnapshot.topStat.id)}` : 'N/D'}. Weak stat: ${guideSnapshot.weakStat ? `${guideSnapshot.weakStat.name} LV.${getEffectiveStatLv(guideSnapshot.weakStat.id)}` : 'N/D'}.`,
    codex: `Pagina attiva: CODEX. Tab attiva: ${guideSnapshot.activeCodexTab?.label || 'SYSTEM'}. Qui devi spiegare regole in linguaggio semplice e operativo.`,
    quests: `Pagina attiva: QUEST BOARD. Tab attiva: ${guideSnapshot.questTabDef?.label || 'attiva'}. Missione focus: ${guideSnapshot.questFocus ? `${guideSnapshot.questFocus.icon} ${guideSnapshot.questFocus.name}` : 'nessuna missione focus'}.`,
    gear: `Pagina attiva: ARMORY. Next unlock: ${guideSnapshot.armoryLead ? `${guideSnapshot.armoryLead.item.icon} ${guideSnapshot.armoryLead.item.name} (${guideSnapshot.armoryLead.progressState.statusLabel})` : 'nessun unlock lead'}. Forge focus: ${guideSnapshot.forgeCandidate ? `${guideSnapshot.forgeCandidate.item.icon} ${getItemDisplayName(guideSnapshot.forgeCandidate.item)} (${guideSnapshot.forgeCandidate.forgeState.label})` : 'nessuna forge prioritaria'}.`,
    boss: `Pagina attiva: BOSS CHAMBER. Boss focus: ${guideSnapshot.bossFocus ? `${guideSnapshot.bossFocus.icon} ${guideSnapshot.bossFocus.name}` : 'nessun boss focus'}. Boss verdict: ${guideSnapshot.todayModel.bossDirective.windowLabel}. Effetti campagna attivi: ${guideSnapshot.bossCampaignEffects?.length ? guideSnapshot.bossCampaignEffects.map(effect => formatCampaignEffectLine(effect)).slice(0, 2).join(' | ') : 'nessuno'}.`,
  };
  const contextLine = contextNotes[guideSnapshot.context] || contextNotes.status;

  return `Sei lo SHADOW GUIDE, un consulente neuro-tattico dentro un'app di gamification chiamata NEURO-LEVELING (ispirata a Solo Leveling).
Rispondi SEMPRE in italiano. Sii conciso, diretto, nerd e in tema col gioco. Usa il tono di un mentore da videogame dark-fantasy che pero sa davvero leggere biomarcatori, stress e performance.
Non usare emoji in eccesso. Max 2-3 frasi per risposta tranne se l'utente chiede spiegazioni dettagliate.
Mescola linguaggio scientifico e linguaggio da sistema di progressione: quest, build, raid, debuff, cooldown, scan, loadout, dungeon, boss.
Evita frasi corporate o troppo adulte: la sensazione deve essere da sistema urgente, misterioso e coinvolgente, non da coach generico.
Non dare mai risposte generiche da chatbot. Devi comportarti come un co-pilot embedded nella pagina attiva: se il contesto cambia, cambia tono, priorita e utilita.
Su Status devi decidere la prossima mossa. Su Profile devi leggere pattern e target. Su Codex devi semplificare regole. Su Quest devi aiutare a scegliere la missione. Su Armory devi spiegare l'azione per il prossimo unlock. Su Boss devi dire se ingaggiare, evitare o preparare.

CONTESTO GIOCATORE:
- Nome: ${state.playerName || 'Hunter'}
- Classe: ${clsName} (Class Sync ${classSync})
- Hunter Rank: ${lv}
- Streak: ${streak} giorni
- Quest completate oggi: ${todayDone}
- Quest totali: ${totalQuests}
- Boss sconfitti: ${bossesDefeated}/${BOSS_DEFINITIONS.length}
- Stat migliori: ${topStats.map(s => `${s.name} LV.${getStatLv(s.id)}`).join(', ')}
- Stat più debole: ${weakStat.name} LV.${getStatLv(weakStat.id)}
- Debuff attivi: ${debuffs.length > 0 ? debuffs.map(d => d.name).join(', ') : 'Nessuno'}
- Ultimo assessment: ${lastA ? `HRV ${lastA.hrv}ms, BOLT ${lastA.bolt}s, Mood ${lastA.mood}/10, Energy ${lastA.energy}/10, Sleep ${lastA.sleep}/10, Stato SNA: ${lastA.ansState}` : 'Non ancora eseguito'}
- Quest personalizzate: ${(state.customQuests || []).length}

CONTESTO PAGINA GUIDE:
- ${contextLine}

COMPETENZE:
- Biohacking, neuroscienze, respirazione, cold exposure, HRV, tono vagale
- Protocolli di ottimizzazione fisica e mentale (Huberman, Wim Hof, ecc.)
- Motivazione, discipline, gestione dello stress
- Consigli su quest, boss, stat, progressione nel gioco

Rispondi alle domande del giocatore con consigli personalizzati basati sul suo profilo.
Quando suggerisci una mossa, rendila concreta e giocabile oggi, come se stessi assegnando il prossimo step di una build.`;
}

async function companionReplyAI(msg) {
  const apiKey = getAiApiKey();
  if (!apiKey) return companionReplyLocal(msg);

  const model = getAiModel();

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': location.origin,
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.8,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: msg },
        ],
      }),
    });

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) return 'API Key non valida. Configurala nelle impostazioni (⚙).';
      return companionReplyLocal(msg);
    }

    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content;
    if (text) return text.trim();
    return companionReplyLocal(msg);
  } catch (e) {
    return companionReplyLocal(msg);
  }
}

function companionReplyLocal(msg) {
  const m = msg.toLowerCase().trim();
  const lv = getTotalLevel();
  const cls = CLASS_DEFINITIONS.find(c=>c.id===state.playerClass);
  const clsName = cls?.name ?? 'Hunter';
  const streak = state.currentStreak;
  const lastA = state.assessmentHistory[state.assessmentHistory.length-1];
  const debuffs = state.activeDebuffs;
  const snapshot = getGuideSituationalSnapshot();
  const context = snapshot.context;

  if (/spiega questa pagina|explain|explain this page/.test(m)) {
    return buildGuidePageExplanation();
  }

  if (context === 'status' && /adesso|ora|cosa faccio|prossima mossa|today command|status/.test(m)) {
    const mission = snapshot.todayModel.mission;
    const campaignLead = snapshot.todayModel.campaign?.targetBoss ? ` Branch campagna viva: ${snapshot.todayModel.campaign.effectLines[0] || snapshot.todayModel.campaign.copy}` : '';
    if (!snapshot.todayModel.scanReady) return 'Status è ancora in fallback. Prima fai il Daily Scan, poi la home diventa una vera sala controllo con missione, boss verdict e reward forecast.';
    return mission
      ? `Mossa prioritaria: ${mission.icon} ${mission.name}. ${snapshot.todayModel.missionReason}${campaignLead}`
      : 'Lo scan è valido ma non c è un target forte: usa Status per proteggere recovery e aspettare la prossima finestra utile.';
  }

  if (context === 'profile' && /build|profilo|pattern|debolezza|target/.test(m)) {
    return `${snapshot.classDef ? `${snapshot.classDef.icon} ${snapshot.classDef.name}` : 'Build non assegnata'}: il core è ${snapshot.topStat ? `${snapshot.topStat.name} LV.${getEffectiveStatLv(snapshot.topStat.id)}` : 'N/D'}, la frattura è ${snapshot.weakStat ? `${snapshot.weakStat.name} LV.${getEffectiveStatLv(snapshot.weakStat.id)}` : 'N/D'}. Priorità: colmare la faglia prima di inseguire target fuori identità.`;
  }

  if (context === 'codex' && /regol|codex|spiega|sistema/.test(m)) {
    return `Sei su ${snapshot.activeCodexTab?.label || 'SYSTEM'}: qui non devi decidere cosa fare ora, devi capire una regola e portarla poi su Status, Quest o Armory. Dimmi quale meccanica vuoi tradurre e la riduco in linguaggio operativo.`;
  }

  if (context === 'quests' && /mission|quest|difficolt|tab|scegli/.test(m)) {
    const mission = snapshot.questFocus;
    const mode = getRecommendedMissionMode(snapshot.latestAssessment, mission);
    const modeInfo = DIFFICULTY_MODES[mode] || DIFFICULTY_MODES.medium;
    return mission
      ? `Missione consigliata in questa schermata: ${mission.icon} ${mission.name}. Mode: ${modeInfo.icon} ${modeInfo.label}. Apri il protocol, esegui quello e ignora il resto.`
      : 'In questa tab il Guide non deve farti leggere tutto: deve isolare una sola missione giocabile ora. Cambia tab o fai prima il Daily Scan se la board non ha un target pulito.';
  }

  if (context === 'gear' && /item|armory|gear|unlock|forge|material/.test(m)) {
    if (snapshot.armoryLead) {
      return `Next unlock: ${snapshot.armoryLead.item.icon} ${snapshot.armoryLead.item.name}. Stato: ${snapshot.armoryLead.progressState.statusLabel}. Azione richiesta: ${snapshot.armoryLead.progressState.missingLine}`;
    }
    if (snapshot.forgeCandidate) {
      return `Focus forge: ${snapshot.forgeCandidate.item.icon} ${getItemDisplayName(snapshot.forgeCandidate.item)}. ${snapshot.forgeCandidate.forgeState.hint}`;
    }
    return 'Armory senza lead chiaro: in questo caso la mossa utile è riaprire preview, slot vuoti e mission routing finché un pezzo torna a muoversi.';
  }

  if (context === 'boss' && /boss|fight|ingaggi|evitare|prepare|raid/.test(m)) {
    const directive = snapshot.todayModel.bossDirective;
    const campaignLead = snapshot.bossCampaignEffects?.length ? ` Campagna attiva: ${snapshot.bossCampaignEffects.map(effect => formatCampaignEffectLine(effect)).slice(0, 2).join(' · ')}` : '';
    return snapshot.bossFocus
      ? `${directive.windowLabel}: ${snapshot.bossFocus.icon} ${snapshot.bossFocus.name}. ${directive.tacticalReason}${campaignLead}`
      : 'Nessun boss ha una finestra credibile ora. In Boss Chamber la decisione giusta può essere preparare, non combattere.';
  }

  // Greetings
  if (/^(ciao|hey|salve|buon)/.test(m))
    return `Salve, ${clsName}. Hunter Rank ${lv}, streak di ${streak} giorni. Come posso aiutarti?`;

  // Stats / Status
  if (/stat|livell|level|punti|profilo|come sto/.test(m)) {
    const top3 = [...PRIMARY_STATS].sort((a,b)=>getStatLv(b.id)-getStatLv(a.id)).slice(0,3);
    const weak = [...PRIMARY_STATS].sort((a,b)=>getStatLv(a.id)-getStatLv(b.id))[0];
    return `Le tue stat migliori: ${top3.map(s=>`${s.name} LV.${getStatLv(s.id)}`).join(', ')}. ` +
      `Stat più fragile: ${weak.name} LV.${getStatLv(weak.id)}. Se la rinforzi, aumenti davvero la qualità della build.`;
  }

  // Quest advice
  if (/quest|cosa (devo|posso) fare|missione|attività|consig/.test(m)) {
    if (debuffs.length > 0)
      return `Hai ${debuffs.length} debuff attivi (${debuffs.map(d=>d.name).join(', ')}). Priorità: quest di recovery come Vagal Reset e Box Breathing.`;
    if (lastA?.ansState==='SYMPATHETIC')
      return 'Il tuo SNA è in modalità simpatica. Concentrati su Vagal Reset e Box Breathing prima di qualsiasi altra quest.';
    return 'Tutte le quest sono autorizzate. Attacca le quest ad alta difficoltà nelle prime 4 ore della giornata per sfruttare il picco di cortisolo endogeno.';
  }

  // Boss advice
  if (/boss|sfida|combat|nemico/.test(m)) {
    const available = BOSS_DEFINITIONS.filter(b => !state.bossesDefeated.includes(b.id) && meetsReq(b.req));
    if (available.length === 0) {
      const locked = BOSS_DEFINITIONS.filter(b => !state.bossesDefeated.includes(b.id) && !meetsReq(b.req));
      if (locked.length > 0) {
        const next = locked[0];
        const missing = next.req.filter(r=>getStatLv(r.stat)<r.minLv).map(r=>`${r.stat} LV.${r.minLv}`);
        return `Nessun boss disponibile. Per sbloccare ${next.name}, ti servono: ${missing.join(', ')}. Fai quest mirate.`;
      }
      return 'Hai sconfitto tutti i boss! Sei un vero Shadow Monarch. Continua a fare quest per consolidare le tue stat.';
    }
    return `Boss disponibili: ${available.map(b=>`${b.icon} ${b.name} (LV.${b.level})`).join(', ')}. Preparati con i protocolli giusti.`;
  }

  // Sleep
  if (/sonn|sleep|dormi|riposo|stanco/.test(m))
    return 'Il sonno è il protocollo di recupero #1. Target: 7-9 ore, temperatura stanza 18-19°C, no schermi 1h prima. La qualità del sonno influenza direttamente HRV, BOLT e tutte le stat.';

  // Breathing
  if (/respir|breath|bolt|co2|apnea/.test(m))
    return `Il tuo BOLT score attuale è ${lastA?.bolt ?? '?'}s. Target: >25s per funzionalità base, >40s per performance. Pratica respirazione nasale ridotta e Box Breathing quotidianamente.`;

  // HRV
  if (/hrv|variabilità|cuore|cardiac/.test(m))
    return `HRV attuale: ${lastA?.hrv ?? '?'}ms. Un HRV alto indica alta capacità adattiva del SNA. Per migliorarla: sonno, respirazione, cold exposure, e riduzione dello stress cronico.`;

  // Stress / Anxiety
  if (/stress|ansia|ansioso|panico|paura/.test(m))
    return 'Quando il sistema è in overdrive simpatico, la corteccia prefrontale va offline. Protocollo: 1) Physiological Sigh (doppia inspirazione + lunga espirazione), 2) Grounding 5-4-3-2-1, 3) Cold exposure del viso. Questo forza il freno vagale.';

  // Motivation
  if (/motiv|pigr|non ho voglia|demotiv|arrender/.test(m))
    return 'La motivazione non è un prerequisito, è un risultato dell\'azione. Regola dei 2 minuti: inizia con la quest più piccola. Il cervello rilascia dopamina al COMPLETAMENTO, non all\'inizio. Ogni quest completata rinforza il circuito.';

  // Class
  if (/class|percorso|specializzazione|ruolo/.test(m))
    return `La tua classe è ${clsName} con Class Sync ${getClassLevel()}. Hunter Rank è il livello globale, mentre la Class Sync misura quanto la tua build sta diventando davvero coerente.`;

  // Streak
  if (/streak|cosecutiv|giorni/.test(m))
    return `Streak attuale: ${streak} giorni. Ogni giorno di streak aggiunge +5% XP bonus (max +50%). Non interrompere la catena!`;

  // Biohacking
  if (/biohack|hack|ottimizz|supplement|nootropi/.test(m))
    return 'I fondamentali prima dei supplementi: 1) Sonno ottimale, 2) Respirazione nasale, 3) Cold exposure, 4) Allenamento, 5) Esposizione solare mattutina. Questi modificano neurochimicamente il sistema più di qualsiasi nootropo.';

  // Nutrition
  if (/cibo|mangi|nutri|diet|aliment/.test(m))
    return 'Nutrizione per performance: proteine sufficienti (1.6-2g/kg), grassi omega-3, verdure crucifere, minimizzare zuccheri raffinati. Il timing conta: pasto proteico post-allenamento, carboidrati la sera per favorire il sonno.';

  // Default
  const tips = [
    `Ricorda, ${clsName}: la costanza batte l'intensità. ${streak} giorni di streak è un buon inizio.`,
    `Il tuo Hunter Rank è ${lv}. Ogni quest completata ti avvicina al prossimo titolo.`,
    'Chiedimi di stat, quest, boss, sonno, respirazione, stress, motivazione o biohacking.',
    `Hai ${state.questsCompleted} quest completate e ${state.bossesDefeated.length} boss sconfitti. Continua così.`,
    'La neuroplasticità è dalla tua parte. Ogni protocollo eseguito crea nuovi circuiti neurali.',
  ];
  return tips[Math.floor(Math.random()*tips.length)];
}

// ========================
// DOM REFERENCES
// ========================

const $$ = sel => document.querySelectorAll(sel);

// ========================
// ONBOARDING
// ========================

function initOnboarding() {
  if (state.onboardingDone) {
    $('onboarding').classList.add('hidden');
    $('mainApp').classList.remove('hidden');
    return;
  }
  $('onboarding').classList.remove('hidden');
  $('mainApp').classList.add('hidden');

  // Slider sync
  const sliderMap = [
    ['onbStudyYears','valStudyYears'],['onbReadHabit','valReadHabit'],
    ['onbSportYears','valSportYears'],['onbWeeklyTraining','valWeeklyTraining'],
    ['onbWorkYears','valWorkYears'],['onbChanges','valChanges'],
    ['onbStress','valStress'],['onbSleepQuality','valSleepQuality'],
    ['onbSocial','valSocial'],['onbEmpathy','valEmpathy'],
    ['onbNutrition','valNutrition'],['onbSleepHours','valSleepHours'],
  ];
  for (const [sid,vid] of sliderMap) {
    const sl = $(sid); const vl = $(vid);
    if (sl && vl) sl.addEventListener('input', () => { vl.textContent = sl.value; });
  }

  renderAvatarPicker({
    emojiContainerId: 'onbAvatarEmojiChoices',
    colorContainerId: 'onbAvatarColorChoices',
    previewId: 'onbAvatarPreview',
  });

  // Start
  $('onbStart').addEventListener('click', () => {
    const name = $('onbName').value.trim();
    if (!name) { $('onbName').focus(); return; }
    state.playerName = name;
    state.profileStrengths = $('onbStrengths').value.trim();
    state.profileWeaknesses = $('onbWeaknesses').value.trim();
    state.profileFears = $('onbFears').value.trim();
    goOnbStep(1);
  });

  // Nav buttons
  $$('.onb-nav [data-next]').forEach(btn => {
    btn.addEventListener('click', () => goOnbStep(parseInt(btn.dataset.next)));
  });
  $$('.onb-nav [data-prev]').forEach(btn => {
    btn.addEventListener('click', () => goOnbStep(parseInt(btn.dataset.prev)));
  });

  // Finish
  $('onbFinish').addEventListener('click', () => {
    processOnboarding();
  });

  // Enter
  $('onbEnter').addEventListener('click', async () => {
    state.onboardingDone = true;
    if (!state.startHere?.startedAt) state.startHere.startedAt = new Date().toISOString();
    await saveState({ immediate: true });
    $('onboarding').classList.add('hidden');
    $('mainApp').classList.remove('hidden');
    switchScreen('status');
    triggerGlitch();
  });
}

function goOnbStep(n) {
  $$('.onb-step').forEach(s => s.classList.remove('active'));
  const step = $('onbStep'+n);
  if (step) step.classList.add('active');
  triggerGlitch();
}

function processOnboarding() {
  // Collect values
  state.profileStrengths = $('onbStrengths').value.trim();
  state.profileWeaknesses = $('onbWeaknesses').value.trim();
  state.profileFears = $('onbFears').value.trim();
  const edu = parseInt($('onbEducation').value);
  const studyYears = parseInt($('onbStudyYears').value);
  const readHabit = parseInt($('onbReadHabit').value);
  const sportYears = parseInt($('onbSportYears').value);
  const sportLevel = parseInt($('onbSportLevel').value);
  const weeklyTrain = parseInt($('onbWeeklyTraining').value);
  const workYears = parseInt($('onbWorkYears').value);
  const leadership = parseInt($('onbLeadership').value);
  const changes = parseInt($('onbChanges').value);
  const meditation = parseInt($('onbMeditation').value);
  const stress = parseInt($('onbStress').value);
  const sleepQ = parseInt($('onbSleepQuality').value);
  const social = parseInt($('onbSocial').value);
  const publicSpk = parseInt($('onbPublicSpeaking').value);
  const empathy = parseInt($('onbEmpathy').value);
  const nutrition = parseInt($('onbNutrition').value);
  const biohack = parseInt($('onbBiohack').value);
  const sleepH = parseFloat($('onbSleepHours').value);

  // Calculate primary stats (1-15 initial range)
  const STR = Math.min(15, 1 + Math.round(sportLevel*1.5 + weeklyTrain*0.5 + sportYears*0.15));
  const RES = Math.min(15, 1 + Math.round(sportYears*0.3 + weeklyTrain*0.6 + sleepQ*0.2 + nutrition*0.15));
  const AGI = Math.min(15, 1 + Math.round(sportLevel*1.0 + weeklyTrain*0.4 + changes*0.2 + biohack*0.3));
  const INT = Math.min(15, 1 + Math.round(edu*1.2 + studyYears*0.3 + readHabit*0.5 + biohack*0.2));
  const WIL = Math.min(15, 1 + Math.round(meditation*1.0 + stress*0.5 + changes*0.2 + sportLevel*0.3));
  const CHA = Math.min(15, 1 + Math.round(social*0.5 + publicSpk*1.5 + empathy*0.3 + leadership*0.8));

  const primaryMap = { STR, RES, AGI, INT, WIL, CHA };

  // Set primary stats
  for (const [id,val] of Object.entries(primaryMap)) {
    state.stats[id] = { lv: val, xp: 0 };
  }

  // Calculate secondary stats (derived from primary, scaled down)
  for (const s of SECONDARY_STATS) {
    const d1 = primaryMap[s.derivedFrom[0]] ?? 1;
    const d2 = primaryMap[s.derivedFrom[1]] ?? 1;
    const val = Math.max(1, Math.min(10, Math.round((d1+d2)*0.4)));
    state.stats[s.id] = { lv: val, xp: 0 };
  }

  const primaryAvg = Object.values(primaryMap).reduce((sum, value) => sum + value, 0) / Object.keys(primaryMap).length;
  const secondaryAvg = SECONDARY_STATS.reduce((sum, stat) => sum + state.stats[stat.id].lv, 0) / SECONDARY_STATS.length;
  state.onboardingRank = Math.max(1, Math.min(20, Math.round(primaryAvg * 0.9 + secondaryAvg * 0.55)));

  // Determine class
  const cl = determineClass(primaryMap);
  state.playerClass = cl.id;
  state.classLevel = 1;
  saveState();

  // Show reveal
  $('classIcon').textContent = cl.icon;
  $('className').textContent = cl.name;
  $('className').dataset.text = cl.name;
  $('classDesc').textContent = `${cl.desc} Partenza registrata: Hunter Rank ${state.onboardingRank}, Class Sync ${getClassLevel()}. Da qui in avanti sali solo con quest, boss, gear e consumabili.`;

  // Stats preview
  const preview = $('statsPreview');
  preview.innerHTML = '';
  const colors = {};
  for (const s of PRIMARY_STATS) colors[s.id] = s.color;
  for (const s of SECONDARY_STATS) colors[s.id] = s.color;

  for (const s of PRIMARY_STATS) {
    const lv = getStatLv(s.id);
    const pct = Math.min((lv/15)*100, 100);
    preview.innerHTML += `
      <div class="onb-stat-row">
        <span class="onb-stat-name">${s.icon} ${s.name}</span>
        <div class="onb-stat-bar"><div class="onb-stat-fill" style="width:${pct}%;background:${s.color}"></div></div>
        <span class="onb-stat-val" style="color:${s.color}">${lv}</span>
      </div>`;
  }

  renderUserAvatar(currentUser?.user_metadata || {});
  goOnbStep(7);
}

// ========================
// NAVIGATION
// ========================

function switchScreen(name) {
  if (name !== 'companion') lastGuideContextScreen = name;
  currentScreen = name;
  $$('.screen').forEach(s => s.classList.remove('active'));
  const el = $('screen' + name.charAt(0).toUpperCase() + name.slice(1));
  if (el) el.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  triggerGlitch();

  if (name==='status') renderStatus();
  else if (name==='profile') renderProfile();
  else if (name==='codex') renderCodex();
  else if (name==='quests') renderQuests();
  else if (name==='boss') renderBossGrid();
  else if (name==='gear') renderGear();
  else if (name==='companion') renderGuideContext();

  setTimeout(() => {
    syncAppChromeMetrics();
    maybeShowSystemPopup('screen-switch');
  }, 120);
}

$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
});

// ========================
// GLITCH & TOASTS
// ========================

function triggerGlitch() {
  const o = $('glitchOverlay');
  o.classList.add('flash');
  setTimeout(() => o.classList.remove('flash'), 200);
}

function showToast(msg, type='success') {
  const c = $('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast toast-'+type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function unlockSystemAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  if (!_systemAudioContext) _systemAudioContext = new AudioCtx();
  if (_systemAudioContext.state === 'suspended') _systemAudioContext.resume();
  _systemAudioUnlocked = true;
}

function playSystemAlertSound(level='soft') {
  if (!_systemAudioUnlocked) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  if (!_systemAudioContext) _systemAudioContext = new AudioCtx();
  const ctx = _systemAudioContext;
  const now = ctx.currentTime;
  const notes = level === 'urgent' ? [220, 330, 220, 440] : level === 'reward' ? [392, 494, 587] : [330, 392];

  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = level === 'urgent' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(freq, now + index * 0.09);
    gain.gain.setValueAtTime(0.0001, now + index * 0.09);
    gain.gain.exponentialRampToValueAtTime(level === 'urgent' ? 0.06 : 0.04, now + index * 0.09 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.09 + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + index * 0.09);
    osc.stop(now + index * 0.09 + 0.18);
  });
}

function ensureSystemPopupLoop() {
  if (!SYSTEM_POPUPS_ENABLED) return;
  if (_systemPopupInterval) return;
  _systemPopupInterval = setInterval(() => {
    maybeShowSystemPopup('passive');
  }, 30000);
}

function removeSystemPopup(node) {
  if (!node) return;
  node.style.animation = 'sysOut .25s ease-in forwards';
  setTimeout(() => node.remove(), 240);
}

function showSystemPopup({ title, body, tone='info', badge='SYSTEM', urgent=false, sound=null }) {
  if (!SYSTEM_POPUPS_ENABLED) return;
  const layer = $('systemPopupLayer');
  if (!layer) return;
  _lastSystemPopupAt = Date.now();

  const popup = document.createElement('div');
  popup.className = `system-popup ${tone} ${urgent ? 'urgent' : ''}`;
  popup.innerHTML = `
    <button class="system-popup-close" aria-label="Chiudi">✕</button>
    <div class="system-popup-header">
      <span class="system-popup-badge">${badge}</span>
      <div class="system-popup-title">${title}</div>
    </div>
    <div class="system-popup-body">${body}</div>
  `;
  layer.prepend(popup);
  if (urgent) triggerGlitch();
  if (sound) playSystemAlertSound(sound);

  const closeBtn = popup.querySelector('.system-popup-close');
  if (closeBtn) closeBtn.addEventListener('click', () => removeSystemPopup(popup));
  setTimeout(() => removeSystemPopup(popup), urgent ? 9200 : 7200);
}

function getSystemPopupCandidates() {
  const candidates = [];
  const completedToday = (state.todayCompletedDetails || []).length;
  const activeDebuffs = state.activeDebuffs || [];
  const today = new Date().toDateString();

  if ((!state.lastAssessmentDate || state.lastAssessmentDate !== today) && currentScreen !== 'assess') {
    candidates.push({
      tone: 'warning',
      badge: 'SYSTEM ALERT',
      title: 'SCAN GIORNALIERO MANCANTE',
      body: 'Il Quest Board e in modalita approssimativa. Avvia subito l\'assessment per riallineare biomarcatori, danger rating e drop consigliati.',
      urgent: true,
      sound: 'urgent',
    });
  }

  if (activeDebuffs.length > 0) {
    candidates.push({
      tone: 'warning',
      badge: 'WARNING',
      title: 'DEBUFF HOSTILI RILEVATI',
      body: `Sono attivi ${activeDebuffs.length} debuff. Priorita assoluta a recovery, respirazione e reset vagale prima di forzare un raid difficile.`,
      urgent: true,
      sound: 'urgent',
    });
  }

  if (currentScreen === 'quests' && currentQuests.length > 0) {
    const nextQuest = currentQuests[0];
    candidates.push({
      tone: 'info',
      badge: 'QUEST FEED',
      title: 'MISSIONE PRIORITARIA DISPONIBILE',
      body: `${nextQuest.icon} ${nextQuest.name} e in coda nel board. Rating di minaccia ${nextQuest.diff}/10. Entraci ora e capitalizza il momentum.`,
      sound: 'soft',
    });
  }

  if (completedToday >= 3) {
    candidates.push({
      tone: 'reward',
      badge: 'CHAIN',
      title: 'COMBO WINDOW APERTA',
      body: `Hai completato ${completedToday} quest oggi. Momentum alto: continua il run per stackare streak, combo e possibili drop.`,
      sound: 'reward',
    });
  }

  if (state.bossesDefeated.length === 0 && currentScreen === 'status') {
    candidates.push({
      tone: 'info',
      badge: 'BOSS',
      title: 'BOSS CHAMBER BLOCCATA',
      body: 'La camera del boss non ti riconosce ancora come minaccia. Farma livelli, gear e quest chiave per forzare l\'ingresso.',
    });
  }

  return candidates;
}

function maybeShowSystemPopup(trigger='passive', forcedPopup=null) {
  if (!SYSTEM_POPUPS_ENABLED) return;
  if (document.hidden) return;
  if (forcedPopup) {
    showSystemPopup(forcedPopup);
    return;
  }
  if (!currentUser) return;

  const minGap = trigger === 'passive' ? 35000 : 12000;
  if (Date.now() - _lastSystemPopupAt < minGap) return;

  const candidates = getSystemPopupCandidates();
  if (!candidates.length) return;

  const chance = trigger === 'passive' ? 0.35 : 0.55;
  if (Math.random() > chance) return;

  const popup = candidates[Math.floor(Math.random() * candidates.length)];
  showSystemPopup(popup);
}

// ========================
// RENDER: STATUS
// ========================

function renderStatus() {
  ensureSystemPopupLoop();
  renderTodayCommand();
  renderStartHereModule();
  renderProgressLayers();
  const nm = $('playerNameLg');
  nm.textContent = state.playerName || 'HUNTER';
  nm.dataset.text = nm.textContent;

  const cl = CLASS_DEFINITIONS.find(c=>c.id===state.playerClass);
  $('playerClassBadge').textContent = cl ? `${cl.icon} ${cl.name} · Class Sync ${getClassLevel()}` : '';
  $('playerTitleBar').textContent = getTitle();
  const rankInfo = getHunterRankInfo();
  $('totalLvPill').textContent = rankInfo.rank;

  // XP bar — hunter rank progression from total earned XP after onboarding rank
  const pct = rankInfo.nextXp > 0 ? Math.min((rankInfo.xpIntoRank / rankInfo.nextXp) * 100, 100) : 100;
  $('xpBarFill').style.width = pct+'%';
  $('xpCur').textContent = rankInfo.xpIntoRank;
  $('xpNext').textContent = rankInfo.nextXp;

  // Debuffs
  const debEl = $('debuffsList');
  if (state.activeDebuffs.length === 0) {
    debEl.innerHTML = '<div class="debuff-card ok">◈ SISTEMA STABILE</div>';
  } else {
    debEl.innerHTML = state.activeDebuffs.map(d =>
      `<div class="debuff-card active-d">${d.icon} ${d.name}</div>`
    ).join('');
  }

  // Active Buffs
  const buffsEl = $('statusBuffs');
  if (buffsEl) {
    const buffs = getActiveBuffs();
    if (buffs.length === 0) {
      buffsEl.innerHTML = '<div class="no-buffs">Nessun buff attivo</div>';
    } else {
      buffsEl.innerHTML = buffs.map(b => {
        const t = BUFF_CATALOG[b.buffId];
        const remaining = t.durType === 'quest' ? `${b.usesLeft} quest` : formatTimeLeft(b.activatedAt + t.dur - Date.now());
        return `<div class="buff-card"><span class="buff-icon">${t.icon}</span><div class="buff-info"><div class="buff-name">${t.name}</div><div class="buff-desc">${t.desc}</div><div class="buff-time">${remaining}</div></div></div>`;
      }).join('');
    }
  }
}

function renderStatRows(statDefs) {
  return statDefs.map(stat => {
    const level = getStatLv(stat.id);
    const bonus = getEquipmentBonusForStat(stat.id);
    const shownLevel = level + bonus;
    const xpNext = xpForLevel(level + 1);
    const xpCurrent = state.stats[stat.id]?.xp ?? 0;
    const pct = Math.min((xpCurrent / Math.max(xpNext, 1)) * 100, 100);
    return `<div class="stat-row">
      <div class="stat-icon">${stat.icon}</div>
      <div class="stat-info">
        <div class="stat-name"><span class="stat-name-txt">${stat.name}</span><span class="stat-lv" style="color:${stat.color}">LV.${shownLevel}${bonus ? ` (+${bonus})` : ''}</span></div>
        <div class="stat-bar-wrap"><div class="stat-bar-fill" style="width:${pct}%;background:${stat.color}"></div></div>
      </div>
    </div>`;
  }).join('');
}

function renderFactionProgressRows() {
  return FACTION_DEFINITIONS.map(faction => {
    const rep = state.factionRep?.[faction.id] ?? 0;
    const rank = getFactionRank(faction.id);
    const nextRank = FACTION_RANKS.find(entry => entry.rep > rep);
    const pct = nextRank ? Math.min((rep / nextRank.rep) * 100, 100) : 100;
    return `<div class="faction-row">
      <div class="faction-head"><span>${faction.icon} ${faction.name}</span><span class="faction-rank" style="color:${faction.color}">${rank.name}</span></div>
      <div class="faction-bar-wrap"><div class="faction-bar-fill" style="width:${pct}%;background:${faction.color}"></div></div>
      <div class="faction-rep">${rep} REP ${nextRank ? `/ ${nextRank.rep}` : '(MAX)'} — x${rank.mult} XP</div>
    </div>`;
  }).join('');
}

function renderAchievementBadges() {
  const unlocked = state.achievements || [];
  return ACHIEVEMENT_DEFINITIONS.map(achievement => {
    const done = unlocked.includes(achievement.id);
    return `<div class="ach-badge ${done ? 'ach-done' : 'ach-locked'}" title="${achievement.desc}">${achievement.icon}<span class="ach-name">${achievement.name}</span></div>`;
  }).join('');
}

function renderProfile() {
  const root = $('screenProfile');
  if (!root) return;
  const titleGrid = $('profileTitleGrid');
  const recGrid = $('profileRecommendations');
  const summary = $('profileSummary');
  const primaryStats = $('profileStatsPrimary');
  const secondaryStats = $('profileStatsSecondary');
  const factionGrid = $('profileFactions');
  const achievementGrid = $('profileAchievements');
  const avatar = getAvatarConfig();
  const recommendations = getProfileRecommendations();
  const titles = getSelectableTitles();
  const classDef = CLASS_DEFINITIONS.find(c => c.id === state.playerClass);
  const topStats = [...PRIMARY_STATS]
    .sort((left, right) => getEffectiveStatLv(right.id) - getEffectiveStatLv(left.id))
    .slice(0, 3)
    .map(stat => `${stat.icon} ${stat.name} LV.${getEffectiveStatLv(stat.id)}`)
    .join(' · ');
  const leadFaction = getLeadFactionProgress();

  summary.innerHTML = `
    <div class="profile-summary-card">
      <div class="profile-summary-head">
        <div class="profile-avatar-large" style="background:linear-gradient(135deg, ${avatar.color}, #0a1020)">${avatar.emoji}</div>
        <div>
          <div class="profile-summary-name">${state.playerName || 'Hunter'}</div>
          <div class="profile-summary-meta">${getTitle()} · Hunter Rank ${getTotalLevel()} · Class Sync ${getClassLevel()}${classDef ? ` · ${classDef.icon} ${classDef.name}` : ''}</div>
        </div>
      </div>
      <div class="profile-trait-stack">
        <div class="profile-trait-line"><strong>Punti forti:</strong> ${state.profileStrengths || 'Non definiti'}</div>
        <div class="profile-trait-line"><strong>Punti deboli:</strong> ${state.profileWeaknesses || 'Non definiti'}</div>
        <div class="profile-trait-line"><strong>Paure:</strong> ${state.profileFears || 'Non definite'}</div>
        <div class="profile-trait-line"><strong>Build dominante:</strong> ${topStats || 'In definizione'}</div>
        <div class="profile-trait-line"><strong>Allineamento principale:</strong> ${leadFaction ? `${leadFaction.faction.icon} ${leadFaction.faction.name} · ${leadFaction.rep} REP` : 'Nessuna fazione dominante'}</div>
      </div>
    </div>`;

  primaryStats.innerHTML = renderStatRows(PRIMARY_STATS);
  secondaryStats.innerHTML = renderStatRows(SECONDARY_STATS);
  factionGrid.innerHTML = renderFactionProgressRows();
  achievementGrid.innerHTML = renderAchievementBadges();

  titleGrid.innerHTML = `
    <button class="title-choice ${!state.activeBossTitle ? 'active' : ''}" data-title-value="">
      <span class="title-choice-origin">AUTO</span>
      <span class="title-choice-name">${getRankTitle()}</span>
    </button>
    ${titles.map(entry => `
      <button class="title-choice ${state.activeBossTitle === entry.title ? 'active' : ''}" data-title-value="${entry.title}">
        <span class="title-choice-origin">${entry.origin === 'boss' ? 'BOSS' : 'RANK'}</span>
        <span class="title-choice-name">${entry.title}</span>
      </button>`).join('')}`;

  recGrid.innerHTML = Object.entries(recommendations).map(([key, entry]) => `
    <div class="profile-reco-card profile-reco-${key}">
      <div class="profile-reco-head">
        <span class="profile-reco-badge">${entry.label}</span>
        <span class="profile-reco-source">${entry.text || 'Non definito'}</span>
      </div>
      <div class="profile-reco-body">
        <div class="profile-reco-block">
          <div class="profile-reco-title">Mission target</div>
          <div class="profile-reco-copy">${entry.quest ? `${entry.quest.icon} ${entry.quest.name}` : 'Nessuna quest disponibile.'}</div>
          <div class="profile-reco-sub">${entry.quest ? entry.quest.desc : 'Completa altre missioni o assessment.'}</div>
        </div>
        <div class="profile-reco-block">
          <div class="profile-reco-title">Boss target</div>
          <div class="profile-reco-copy">${entry.boss ? `${entry.boss.icon} ${entry.boss.name}` : 'Nessun boss disponibile.'}</div>
          <div class="profile-reco-sub">${entry.boss ? `${entry.boss.title}. ${meetsReq(entry.boss.req) ? 'Puoi affrontarlo ora.' : `Prima alza: ${entry.boss.req.filter(req => !meetsReq([req])).map(req => `${req.stat} ${req.minLv}`).join(' · ')}`}` : 'Continua la progressione per sbloccare nuovi target.'}</div>
        </div>
      </div>
    </div>`).join('');

  titleGrid.querySelectorAll('[data-title-value]').forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveTitle(btn.dataset.titleValue || null);
      renderStatus();
      renderProfile();
      showToast(btn.dataset.titleValue ? `Titolo attivo: ${btn.dataset.titleValue}` : 'Titolo automatico attivato', 'success');
    });
  });
}

// ========================
// RENDER: QUESTS
// ========================

let currentQuests = [];
let questTab = 'corpo';

const QUEST_TAB_DEFS = [
  { id:'corpo',    label:'💪 CORPO',      slots: 6, filter: q => q.cat === 'PHYSIQUE' },
  { id:'mente',    label:'🧠 MENTE',      slots: 6, filter: q => q.cat === 'COGNITIVE' || q.cat === 'NEURAL' },
  { id:'emozioni', label:'💜 EMOZIONI',   slots: 6, filter: q => q.cat === 'SOCIAL' || q.type === 'RECOVERY' },
  { id:'special',  label:'✦ SPECIAL',    slots: 4, filter: q => q.type === 'SPECIAL' },
  { id:'timed',    label:'⏱ TIMED',      slots: 5, filter: q => !!q.timed },
  { id:'nontimed', label:'📋 NON TIMED', slots: 6, filter: q => !q.timed },
  { id:'completed',label:'✅ COMPLETATE', filter: null },
  { id:'weekly',   label:'WEEKLY',        filter: null },
  { id:'chains',   label:'CHAINS',        filter: null },
  { id:'custom',   label:'CUSTOM',        filter: null },
];

function getVisibleDailyQuests(allQuests, tabDef) {
  const filtered = tabDef?.filter ? allQuests.filter(tabDef.filter) : allQuests;
  const doneIds = new Set(state.todayCompleted || []);
  const active = filtered.filter(q => !doneIds.has(q.id));
  return active.slice(0, tabDef?.slots || active.length);
}

function getCompletedDailyQuestEntries() {
  return (state.todayCompletedDetails || [])
    .map((detail, index) => ({
      ...detail,
      quest: findQuestById(detail.id),
      index,
    }))
    .filter(entry => !!entry.quest)
    .reverse();
}

function renderQuestTabs() {
  const tabs = $('questTabs');
  if (!tabs) return;
  tabs.innerHTML = QUEST_TAB_DEFS.map(t => {
    const active = questTab === t.id ? 'tab-active' : '';
    return `<button class="quest-tab ${active}" data-tab="${t.id}">${t.label}</button>`;
  }).join('') + `<button class="quest-tab add-quest-btn" id="btnAddQuestTab">＋</button>`;
  tabs.querySelectorAll('.quest-tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => { questTab = btn.dataset.tab; renderQuests(); });
  });
  const addBtn = $('btnAddQuestTab');
  if (addBtn) addBtn.addEventListener('click', openCreateQuestModal);
}

function renderQuests() {
  ensureSystemPopupLoop();
  renderQuestTabs();
  const dailyBonus = getDailyBonus();
  const tabDef = QUEST_TAB_DEFS.find(t => t.id === questTab);
  if (tabDef && tabDef.filter) renderDailyQuests(dailyBonus, tabDef.filter);
  else if (questTab === 'completed') renderCompletedQuests();
  else if (questTab === 'weekly') renderWeeklyQuests();
  else if (questTab === 'custom') renderCustomQuests();
  else renderChainQuests();
  renderActiveBuffsBanner();
  renderComboTracker();
  requestAnimationFrame(applyPendingQuestBoardFocus);
}

function getQuestPreviewXP(q) {
  const diffEff = Math.max(1, q.diff);
  const rarityMult = RARITY_MULT[getQuestRarity(diffEff)];
  return q.rewards.reduce((sum, reward) => {
    const penalty = getDebuffPenalty(reward.stat);
    return sum + Math.round(calcXP(reward.xp, diffEff, state.currentStreak, penalty) * rarityMult);
  }, 0);
}

function getQuestModePreviewXP(q, modeKey) {
  const mode = DIFFICULTY_MODES[modeKey];
  const diffEff = Math.max(1, q.diff + mode.diffOffset);
  const rarityMult = RARITY_MULT[getQuestRarity(diffEff)];
  return q.rewards.reduce((sum, reward) => {
    const penalty = getDebuffPenalty(reward.stat);
    const scaled = calcXP(reward.xp, diffEff, state.currentStreak, penalty);
    return sum + Math.round(scaled * rarityMult * mode.xpMult);
  }, 0);
}

function renderQuestHintIconsMarkup(q) {
  const hints = getQuestHintIcons(q);
  if (!hints.length) return '';
  return `<div class="quest-hint-icons">${hints.map(hint => `<span class="quest-hint-icon ${hint.motion}">${hint.emoji}</span>`).join('')}</div>`;
}

function buildQuestQuickline(q, options = {}) {
  const { context = 'daily', done = false, locked = false, canComplete = false, isBonus = false, modeInfo = null } = options;
  const parts = [];

  if (done) {
    parts.push(modeInfo ? `Clear registrato in modalita ${modeInfo.label}.` : 'Clear registrato oggi.');
  } else if (locked) {
    parts.push('Bloccata finche la build non soddisfa i requisiti.');
  } else if (context === 'weekly' && canComplete) {
    parts.push('Pronta per il claim della ricompensa weekly.');
  } else if (context === 'weekly' && Array.isArray(q.subQuests) && q.subQuests.length) {
    const subDone = q.subQuests.filter(id => state.todayCompleted.includes(id)).length;
    parts.push(`${subDone}/${q.subQuests.length} obiettivi collegati gia chiusi.`);
  } else if (isBonus) {
    parts.push('Target prioritario di oggi.');
  } else if (q.type === 'SPECIAL') {
    parts.push('Run ad alto valore con progressione loot.');
  } else if (context === 'custom') {
    parts.push('Protocollo creato su misura per la tua build.');
  }

  if (q.timed) parts.push('Esecuzione a tempo.');
  if (!parts.length && q.desc) return escapeHtml(q.desc);
  return escapeHtml(parts.join(' ') || 'Scegli una modalita, esegui il protocollo e apri il razionale solo se ti serve contesto extra.');
}

function renderQuestLayerMarkup({
  protocolId,
  rationaleId,
  protocol = [],
  rationale = '',
  hintMarkup = '',
  protocolFooter = '',
  rationaleFooter = ''
}) {
  const protocolMarkup = protocol.length
    ? `<ol class="quest-protocol-list">${protocol.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`
    : '<p class="quest-layer-empty">Nessun protocollo definito per questa missione.</p>';
  const rationaleMarkup = rationale
    ? `<p class="quest-rationale-copy">${escapeHtml(rationale)}</p>`
    : '<p class="quest-layer-empty">Nessun razionale extra registrato.</p>';

  return `
    <div class="quest-layer-actions">
      <button class="quest-layer-toggle" type="button" data-layer="protocol" data-target="${protocolId}" aria-expanded="false">Protocol</button>
      <button class="quest-layer-toggle" type="button" data-layer="rationale" data-target="${rationaleId}" aria-expanded="false">Why</button>
    </div>
    <div class="q-detail quest-layer quest-layer-protocol" id="${protocolId}">
      <div class="quest-layer-head">
        <span class="quest-layer-kicker">Layer 2</span>
        <h4 class="quest-layer-title">Execution Protocol</h4>
      </div>
      ${protocolMarkup}
      ${protocolFooter}
    </div>
    <div class="quest-layer quest-layer-rationale" id="${rationaleId}">
      <div class="quest-layer-head">
        <span class="quest-layer-kicker">Layer 3</span>
        <h4 class="quest-layer-title">Science + Signals</h4>
      </div>
      ${rationaleMarkup}
      ${hintMarkup ? `<div class="quest-layer-signals"><span class="quest-signal-label">Segnali utili</span>${hintMarkup}</div>` : ''}
      ${rationaleFooter}
    </div>`;
}

function setQuestLayerOpen(targetId, isOpen) {
  const layer = $(targetId);
  if (!layer) return false;
  layer.classList.toggle('open', isOpen);
  document.querySelectorAll(`.quest-layer-toggle[data-target="${targetId}"]`).forEach(btn => {
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
  return true;
}

function toggleQuestLayer(targetId) {
  const layer = $(targetId);
  if (!layer) return false;
  return setQuestLayerOpen(targetId, !layer.classList.contains('open'));
}

function bindQuestLayerInteractions(listEl, options = {}) {
  const blockedSelectors = ['.diff-mode-btn', '.quest-layer-toggle', '.quest-layer', '.cq-edit-btn', '.cq-del-btn', ...(options.blockedSelectors || [])];

  listEl.querySelectorAll('.quest-layer-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleQuestLayer(btn.dataset.target);
    });
  });

  listEl.querySelectorAll('.quest-card').forEach(card => {
    card.addEventListener('click', e => {
      if (blockedSelectors.some(selector => e.target.closest(selector))) return;
      if (typeof options.onCardClick === 'function') {
        options.onCardClick(card, e);
        return;
      }
      const protocolToggle = card.querySelector('.quest-layer-toggle[data-layer="protocol"]');
      if (protocolToggle) toggleQuestLayer(protocolToggle.dataset.target);
    });
  });
}

function renderDailyQuests(dailyBonus, filterFn) {
  const lastA = state.assessmentHistory[state.assessmentHistory.length-1] || null;
  let allQuests = getAvailableQuests(lastA);
  const tabDef = QUEST_TAB_DEFS.find(t => t.id === questTab);
  currentQuests = getVisibleDailyQuests(allQuests, tabDef);
  const filteredAllQuests = filterFn ? allQuests.filter(filterFn) : allQuests;
  const completedRelevant = filteredAllQuests.filter(q => getDoneInfo(q.id));

  const listEl = $('questList');
  if (currentQuests.length === 0) {
    listEl.innerHTML = `<div class="cq-empty"><div class="cq-empty-icon">✅</div><p>Nessuna quest attiva in questa tab. Completa l'assessment successivo o consulta la tab completate.</p></div>`;
  } else {
  listEl.innerHTML = currentQuests.map(q => {
    const rank = getRank(q.diff);
    const rarity = getQuestRarity(q.diff);
    const doneInfo = getDoneInfo(q.id);
    const done = !!doneInfo;
    const locked = !meetsReq(q.req);
    const cls = done ? 'done' : (locked ? 'locked' : '');
    const previewXp = getQuestPreviewXP(q);
    const isBonus = dailyBonus.questId === q.id;
    const bonusTag = isBonus ? `<span class="daily-bonus-tag">${dailyBonus.bonus === '2X_XP' ? '💎 2X XP' : dailyBonus.bonus === 'LOOT_DROP' ? '🎁 LOOT' : '⚡ CRIT+'}</span>` : '';
    const rarityTag = `<span class="rarity-badge rarity-${rarity.toLowerCase()}">${RARITY_LABELS[rarity]}</span>`;
    const timedTag = q.timed ? '<span class="timed-tag">⏱ TIMED</span>' : '';
    const doneModeBadge = doneInfo?.mode ? `<span class="done-mode-badge" style="color:${DIFFICULTY_MODES[doneInfo.mode].color}">${DIFFICULTY_MODES[doneInfo.mode].icon} ${DIFFICULTY_MODES[doneInfo.mode].label}</span>` : '';
    const gearTag = q.equipmentId ? `<span class="daily-bonus-tag">${EQUIPMENT_CATALOG[q.equipmentId]?.icon || '🎁'} GEAR</span>` : '';
    const lootPreview = q.type === 'SPECIAL'
      ? `<div class="quest-loot-preview">${(SPECIAL_QUEST_LOOT_TABLES[q.id] || [{ itemId: q.equipmentId, weight: 100 }]).map(entry => {
          const lootItem = EQUIPMENT_CATALOG[entry.itemId];
          return `<span class="quest-loot-chip">${lootItem?.icon || '✦'} ${getItemDisplayName(lootItem)} · ${entry.weight}%</span>`;
        }).join('')}</div>`
      : '';
    const questHints = renderQuestHintIconsMarkup(q);

    const xpPreview = !done && !locked ? `<div class="diff-mode-selector" data-qid="${q.id}">
      ${Object.entries(DIFFICULTY_MODES).map(([k,m]) => {
        return `<button class="diff-mode-btn" data-mode="${k}" data-qid="${q.id}" style="border-color:${m.color}"><span class="dm-icon">${m.icon}</span><span class="dm-label">${m.label}</span><span class="dm-xp">+${getQuestModePreviewXP(q, k)}</span></button>`;
      }).join('')}
    </div>` : '';

    return `
      <div class="quest-card ${cls} rarity-border-${rarity.toLowerCase()}" data-quest-id="${q.id}" data-cat="${q.cat}">
        <div class="q-check">${done ? '✓' : (locked ? '🔒' : '')}</div>
        <span class="q-icon">${q.icon}</span>
        <div class="q-body">
          <div class="quest-summary-head">
            <div class="quest-summary-main">
              <div class="q-name">${q.name} ${bonusTag} ${gearTag} ${timedTag} ${doneModeBadge}</div>
              <div class="quest-quickline">${buildQuestQuickline(q, { done, locked, isBonus })}</div>
            </div>
            <div class="q-rank rk-${rank}">${rank}</div>
          </div>
          <div class="q-tags">${rarityTag}<span class="q-cat-tag">${q.cat}</span></div>
          <div class="quest-summary-grid">
            <span class="quest-summary-chip">${q.dur} min</span>
            <span class="quest-summary-chip quest-summary-chip-xp">+${previewXp} XP</span>
            <span class="quest-summary-chip">${locked ? 'Locked' : done ? 'Cleared' : q.type === 'SPECIAL' ? 'Loot Route' : 'Run Ready'}</span>
          </div>
          ${xpPreview}
          ${renderQuestLayerMarkup({
            protocolId: `detail-${q.id}`,
            rationaleId: `why-${q.id}`,
            protocol: q.protocol,
            rationale: q.science,
            hintMarkup: questHints,
            rationaleFooter: lootPreview
          })}
        </div>
      </div>`;
  }).join('');
  }

  const total = currentQuests.length + completedRelevant.length;
  const done = completedRelevant.length;
  const pct = total > 0 ? Math.round((done/total)*100) : 0;
  $('qpFill').style.width = pct+'%';
  $('qpText').textContent = `${done} / ${total}`;
  const totalXP = currentQuests.reduce((a,q) => {
    const de = Math.max(1, q.diff);
    const rr = RARITY_MULT[getQuestRarity(de)];
    return a + q.rewards.reduce((b,r) => b + Math.round(calcXP(r.xp, de, state.currentStreak, getDebuffPenalty(r.stat)) * rr), 0);
  }, 0);
  $('totalRewXp').textContent = totalXP + ' XP';

  // Mode button handlers
  listEl.querySelectorAll('.diff-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const qid = btn.dataset.qid;
      const mode = btn.dataset.mode;
      startQuestWithMode(qid, mode);
    });
  });

  bindQuestLayerInteractions(listEl);
}

function renderCompletedQuests() {
  const entries = getCompletedDailyQuestEntries();
  currentQuests = entries.map(entry => entry.quest);

  const listEl = $('questList');
  if (entries.length === 0) {
    listEl.innerHTML = `<div class="cq-empty"><div class="cq-empty-icon">🗂</div><p>Nessuna quest completata oggi.</p></div>`;
  } else {
    listEl.innerHTML = entries.map(entry => {
      const q = entry.quest;
      const modeInfo = DIFFICULTY_MODES[entry.mode || 'medium'];
      const earnedXp = entry.earnedXp ?? q.rewards.reduce((acc, rew) => acc + rew.xp, 0);
      const timeLbl = q.timed && entry.timeBonus && entry.timeBonus !== 1 ? ` · ⏱ x${entry.timeBonus.toFixed(2)}` : '';
      const gearTag = q.equipmentId ? `<span class="daily-bonus-tag">${EQUIPMENT_CATALOG[q.equipmentId]?.icon || '🎁'} GEAR</span>` : '';
      const questHints = renderQuestHintIconsMarkup(q);
      return `
        <div class="quest-card done rarity-border-${getQuestRarity(q.diff).toLowerCase()}" data-quest-id="${q.id}" data-cat="${q.cat}">
          <div class="q-check">✓</div>
          <span class="q-icon">${q.icon}</span>
          <div class="q-body">
            <div class="quest-summary-head">
              <div class="quest-summary-main">
                <div class="q-name">${q.name} ${gearTag} <span class="done-mode-badge" style="color:${modeInfo.color}">${modeInfo.icon} ${modeInfo.label}</span></div>
                <div class="quest-quickline">${buildQuestQuickline(q, { context: 'completed', done: true, modeInfo })}</div>
              </div>
              <div class="q-rank rk-${getRank(q.diff)}">✓</div>
            </div>
            <div class="q-tags"><span class="q-cat-tag">${q.cat}</span><span class="timed-tag">COMPLETATA</span></div>
            <div class="quest-summary-grid">
              <span class="quest-summary-chip">${q.dur} min${timeLbl}</span>
              <span class="quest-summary-chip quest-summary-chip-xp">+${earnedXp} XP</span>
              <span class="quest-summary-chip">Archive</span>
            </div>
            ${renderQuestLayerMarkup({
              protocolId: `detail-completed-${entry.index}`,
              rationaleId: `why-completed-${entry.index}`,
              protocol: q.protocol,
              rationale: q.science || q.desc,
              hintMarkup: questHints
            })}
          </div>
        </div>`;
    }).join('');

    bindQuestLayerInteractions(listEl);
  }

  const total = entries.length;
  $('qpFill').style.width = total > 0 ? '100%' : '0%';
  $('qpText').textContent = `${total} completate oggi`;
  const totalXP = entries.reduce((sum, entry) => sum + (entry.earnedXp ?? entry.quest.rewards.reduce((acc, rew) => acc + rew.xp, 0)), 0);
  $('totalRewXp').textContent = `${totalXP} XP ottenuti`;
}

function getDoneInfo(qid) {
  return (state.todayCompletedDetails || []).find(d => d.id === qid) || (state.todayCompleted.includes(qid) ? { id:qid, mode:'medium' } : null);
}

// Timed quest state
let activeTimedQuest = null;
let timedQuestStart = 0;
let timedQuestInterval = null;
let activeMissionChecklist = [];

function startQuestWithMode(qid, mode) {
  const quest = findQuestById(qid);
  if (!quest) return;
  if (!meetsReq(quest.req)) { showToast('Requisiti non soddisfatti','alert'); return; }
  if (getDoneInfo(qid)) { showToast('Quest già completata oggi','alert'); return; }

  activeTimedQuest = { quest, mode };
  activeMissionChecklist = quest.protocol.map(() => false);
  timedQuestStart = 0;
  showTimedQuestOverlay(quest, mode);
}

function showTimedQuestOverlay(quest, mode) {
  const ov = $('timedQuestOverlay');
  if (!ov) return;
  const modeInfo = DIFFICULTY_MODES[mode];
  const targetMin = quest.dur;
  $('tqName').textContent = quest.name;
  $('tqMode').textContent = modeInfo.label;
  $('tqMode').style.color = modeInfo.color;
  $('tqDesc').textContent = quest.desc;
  $('tqTarget').textContent = `Obiettivo: ${targetMin} min`;
  $('tqElapsed').textContent = '00:00';
  $('tqBonusPrev').textContent = 'Avvia per iniziare';
  $('tqScience').textContent = quest.science;
  renderMissionChecklist();
  updateMissionActionState();
  ov.classList.remove('hidden');
}

function renderMissionChecklist() {
  const checklistEl = $('tqChecklist');
  const quest = activeTimedQuest?.quest;
  if (!checklistEl || !quest) return;

  checklistEl.innerHTML = quest.protocol.map((step, index) => `
    <label class="tq-check-item ${activeMissionChecklist[index] ? 'done' : ''}">
      <input type="checkbox" data-step-index="${index}" ${activeMissionChecklist[index] ? 'checked' : ''}>
      <span class="tq-check-copy">${step}</span>
    </label>`).join('');

  checklistEl.querySelectorAll('[data-step-index]').forEach(input => {
    input.addEventListener('change', () => {
      activeMissionChecklist[Number(input.dataset.stepIndex)] = input.checked;
      renderMissionChecklist();
      updateMissionActionState();
    });
  });
}

function updateMissionActionState() {
  const quest = activeTimedQuest?.quest;
  if (!quest) return;
  const allChecked = activeMissionChecklist.length > 0 && activeMissionChecklist.every(Boolean);
  const completedSteps = activeMissionChecklist.filter(Boolean).length;
  const startBtn = $('btnTqStart');
  const stopBtn = $('btnTqStop');
  const timerDisplay = $('tqTimerDisplay');
  const hint = $('tqHint');

  timerDisplay.classList.toggle('hidden', !quest.timed);

  if (quest.timed) {
    startBtn.classList.toggle('hidden', !!timedQuestStart);
    stopBtn.classList.toggle('hidden', !timedQuestStart);
    stopBtn.disabled = !allChecked;
    stopBtn.textContent = allChecked ? '✔ COMPLETA QUEST' : `CHECKLIST ${completedSteps}/${activeMissionChecklist.length}`;
    hint.textContent = timedQuestStart
      ? (allChecked ? 'Timer attivo e checklist completa. Puoi chiudere la missione.' : 'Completa tutti i passaggi della checklist prima di confermare la quest.')
      : 'Avvia il timer e segui i passaggi. La conferma finale si sblocca dopo la checklist.';
  } else {
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    stopBtn.disabled = !allChecked;
    stopBtn.textContent = allChecked ? '✔ CONFERMA COMPLETAMENTO' : `CHECKLIST ${completedSteps}/${activeMissionChecklist.length}`;
    hint.textContent = allChecked
      ? 'Checklist completa. Conferma la missione per ottenere XP, materiali e possibili drop.'
      : 'Apri la missione, completa i passaggi e spunta la checklist per chiuderla.';
  }
}

function startTimedQuest() {
  timedQuestStart = Date.now();
  if (timedQuestInterval) clearInterval(timedQuestInterval);
  timedQuestInterval = setInterval(updateTimedQuestDisplay, 1000);
  updateMissionActionState();
  updateTimedQuestDisplay();
}

function updateTimedQuestDisplay() {
  if (!activeTimedQuest || !timedQuestStart) return;
  const elapsed = Math.floor((Date.now() - timedQuestStart) / 1000);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  $('tqElapsed').textContent = `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  const bonus = calcTimeBonus(activeTimedQuest.quest, elapsed);
  const bl = getTimeBonusLabel(bonus);
  $('tqBonusPrev').textContent = `${bl.label} x${bonus.toFixed(2)}`;
  $('tqBonusPrev').style.color = bl.color;
}

function stopTimedQuest() {
  if (!activeMissionChecklist.every(Boolean)) {
    showToast('Completa prima tutti i passaggi della checklist', 'alert');
    return;
  }
  if (timedQuestInterval) { clearInterval(timedQuestInterval); timedQuestInterval = null; }
  if (!activeTimedQuest) return;
  const elapsed = timedQuestStart ? Math.floor((Date.now() - timedQuestStart) / 1000) : 0;
  const timeBonus = calcTimeBonus(activeTimedQuest.quest, elapsed);
  const { quest, mode } = activeTimedQuest;
  $('timedQuestOverlay').classList.add('hidden');
  activeTimedQuest = null;
  activeMissionChecklist = [];
  timedQuestStart = 0;
  completeQuest(quest, mode, quest.timed ? timeBonus : 1.0);
}

function cancelTimedQuest() {
  if (timedQuestInterval) { clearInterval(timedQuestInterval); timedQuestInterval = null; }
  activeTimedQuest = null;
  activeMissionChecklist = [];
  timedQuestStart = 0;
  $('timedQuestOverlay').classList.add('hidden');
}

function renderWeeklyQuests() {
  resetWeeklyIfNeeded();
  const listEl = $('questList');
  listEl.innerHTML = WEEKLY_QUESTS.map(q => {
    const done = (state.weeklyCompleted||[]).includes(q.id);
    const canComplete = !done && checkWeeklyCompletion(q);
    const locked = !meetsReq(q.req);
    const cls = done ? 'done' : (locked ? 'locked' : (canComplete ? 'completable' : ''));
    const totalRew = q.rewards.reduce((a,r) => a + r.xp, 0);
    const subDone = q.subQuests.length > 0 ? q.subQuests.filter(sq => state.todayCompleted.includes(sq)).length : 0;
    const subProgress = q.subQuests.length > 0 ? q.subQuests.map(sq => state.todayCompleted.includes(sq) ? '✅' : '⬜').join(' ') : '';

    return `
      <div class="quest-card ${cls} rarity-border-legendary weekly-card" data-quest-id="${q.id}" data-cat="${q.cat}">
        <div class="q-check">${done ? '✓' : (locked ? '🔒' : (canComplete ? '⚡' : ''))}</div>
        <span class="q-icon">${q.icon}</span>
        <div class="q-body">
          <div class="quest-summary-head">
            <div class="quest-summary-main">
              <div class="q-name">${q.name} <span class="weekly-tag">WEEKLY</span></div>
              <div class="quest-quickline">${buildQuestQuickline(q, { context: 'weekly', done, locked, canComplete })}</div>
            </div>
            <div class="q-rank rk-S">W</div>
          </div>
          <div class="quest-summary-grid">
            <span class="quest-summary-chip">${q.dur} min</span>
            <span class="quest-summary-chip quest-summary-chip-xp">+${totalRew} XP</span>
            <span class="quest-summary-chip">${q.subQuests.length ? `${subDone}/${q.subQuests.length} linked` : 'Weekly target'}</span>
          </div>
          ${renderQuestLayerMarkup({
            protocolId: `detail-${q.id}`,
            rationaleId: `why-${q.id}`,
            protocol: q.protocol,
            rationale: q.science,
            protocolFooter: subProgress ? `<div class="quest-layer-note">${subProgress}</div>` : ''
          })}
        </div>
      </div>`;
  }).join('');

  const total = WEEKLY_QUESTS.length;
  const done = (state.weeklyCompleted||[]).filter(id => WEEKLY_QUESTS.some(q=>q.id===id)).length;
  const pct = total > 0 ? Math.round((done/total)*100) : 0;
  $('qpFill').style.width = pct+'%';
  $('qpText').textContent = `${done} / ${total} weekly`;
  $('totalRewXp').textContent = '';

  bindQuestLayerInteractions(listEl, {
    onCardClick: card => handleQuestClick(card.dataset.questId, 'weekly')
  });
}

function renderChainQuests() {
  const listEl = $('questList');
  listEl.innerHTML = CHAIN_DEFINITIONS.map(chain => {
    const p = getChainProgress(chain.id);
    const pct = p.completed ? 100 : Math.round((p.step / chain.steps.length) * 100);
    const currentStep = p.completed ? null : chain.steps[p.step];
    const rewardXP = chain.completionRewards.reduce((a,r)=>a+r.xp,0);

    return `
      <div class="quest-card chain-card ${p.completed?'done':''}">
        <span class="q-icon">${chain.icon}</span>
        <div class="q-body">
          <div class="q-name">${chain.name} ${p.completed ? '<span class="chain-complete-tag">✅ COMPLETATA</span>' : ''}</div>
          <div class="q-desc">${chain.desc}</div>
          <div class="chain-progress-bar"><div class="chain-fill" style="width:${pct}%"></div></div>
          <div class="chain-steps">
            ${chain.steps.map((s,i) => {
              const icon = i < p.step ? '✅' : (i === p.step && !p.completed ? '▶️' : '⬜');
              const active = i === p.step && !p.completed ? 'chain-step-active' : '';
              return `<div class="chain-step ${active}">${icon} ${s.name}</div>`;
            }).join('')}
          </div>
          ${currentStep ? `<div class="chain-next">Prossimo: <strong>${currentStep.name}</strong> — ${currentStep.desc}</div>` : ''}
          <div class="q-meta"><span class="q-xp">Ricompensa finale: +${rewardXP} XP + BUFF</span></div>
        </div>
      </div>`;
  }).join('');

  const total = CHAIN_DEFINITIONS.length;
  const done = CHAIN_DEFINITIONS.filter(c => getChainProgress(c.id).completed).length;
  $('qpFill').style.width = (total>0?Math.round((done/total)*100):0)+'%';
  $('qpText').textContent = `${done} / ${total} catene`;
  $('totalRewXp').textContent = '';
}

function renderActiveBuffsBanner() {
  let el = $('activeBuffsBanner');
  if (!el) return;
  const buffs = getActiveBuffs();
  if (buffs.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="buffs-banner">${buffs.map(b => {
    const t = BUFF_CATALOG[b.buffId];
    const remaining = t.durType === 'quest' ? `${b.usesLeft} quest` : formatTimeLeft(b.activatedAt + t.dur - Date.now());
    return `<span class="buff-pill">${t.icon} ${t.name} <small>${remaining}</small></span>`;
  }).join('')}</div>`;
}

function formatTimeLeft(ms) {
  if (ms <= 0) return 'scaduto';
  const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function renderComboTracker() {
  let el = $('comboTracker');
  if (!el) return;
  const triggered = state.todayCombos || [];
  const html = COMBO_DEFINITIONS.map(c => {
    const done = triggered.includes(c.id);
    return `<span class="combo-chip ${done?'combo-done':''}">${c.icon} ${c.name}</span>`;
  }).join('');
  el.innerHTML = html;
}

function handleQuestClick(qid, tab) {
  if (tab === 'weekly') {
    const wq = WEEKLY_QUESTS.find(q=>q.id===qid);
    if (!wq) return;
    if ((state.weeklyCompleted||[]).includes(qid)) {
      toggleQuestLayer('detail-'+qid); return;
    }
    if (!meetsReq(wq.req)) { showToast('Requisiti non soddisfatti','alert'); return; }
    if (!checkWeeklyCompletion(wq)) {
      if (setQuestLayerOpen('detail-'+qid, true)) return;
      showToast('Completa prima le sub-quest richieste!','alert');
      return;
    }
    completeWeeklyQuest(wq);
    return;
  }
  // daily cards use mode buttons now, click just opens detail
}

function completeQuest(quest, mode, timeBonus) {
  mode = mode || 'medium';
  timeBonus = timeBonus || 1.0;
  const modeInfo = DIFFICULTY_MODES[mode];
  const diffEff = Math.max(1, quest.diff + modeInfo.diffOffset);
  const rarity = getQuestRarity(diffEff);
  const rarityMult = RARITY_MULT[rarity];
  const isCrit = rollCritical();
  const critMult = isCrit ? 2 : 1;
  const buffMult = getBuffXPMult();
  const factionMult = getFactionMult(quest.cat);
  const dailyBonus = getDailyBonus();
  let dailyMult = 1;
  if (dailyBonus.questId === quest.id && dailyBonus.bonus === '2X_XP') dailyMult = 2;
  let selectedDropItemId = null;

  let totalG = 0, anyLvl = false;
  for (const rew of quest.rewards) {
    const pen = getDebuffPenalty(rew.stat);
    let eff = calcXP(rew.xp, diffEff, state.currentStreak, pen);
    eff = Math.round(eff * rarityMult * modeInfo.xpMult * critMult * buffMult * factionMult * dailyMult * timeBonus);
    eff += getBuffBonusXP(rew.stat);
    if (addStatXP(rew.stat, eff)) anyLvl = true;
    totalG += eff;
  }
  state.totalXP += totalG;
  state.questsCompleted++;
  state.todayCompleted.push(quest.id);
  if (!state.todayCompletedDetails) state.todayCompletedDetails = [];
  state.todayCompletedDetails.push({ id:quest.id, mode, timeBonus, earnedXp: totalG, completedAt: Date.now() });
  if (quest.type === 'SPECIAL') {
    if (!state.specialQuestCompleted) state.specialQuestCompleted = [];
    if (!state.specialQuestCompleted.includes(quest.id)) state.specialQuestCompleted.push(quest.id);
    selectedDropItemId = getQuestDropItemId(quest);
    if (selectedDropItemId) awardEquipment(selectedDropItemId);
  }

  const questMaterial = SET_PRIMARY_MATERIAL[quest.type === 'SPECIAL' ? (EQUIPMENT_CATALOG[selectedDropItemId]?.set || 'IRON_HEART') : ({ PHYSIQUE:'IRON_HEART', COGNITIVE:'MONARCH_SYNTH', NEURAL:'MONARCH_SYNTH', SOCIAL:'SHADOWFORGED' }[quest.cat] || 'IRON_HEART')];
  if (questMaterial) {
    const materialAmount = quest.type === 'SPECIAL' ? 2 : mode === 'hard' ? 2 : 1;
    awardMaterial(questMaterial, materialAmount, quest.name);
  }
  if (quest.type === 'SPECIAL' || mode === 'hard') awardMaterial('BOSS_CORE', 1, quest.name);

  // Faction rep
  addFactionRep(quest.cat, Math.round(10 * rarityMult * modeInfo.xpMult));

  // Consume quest-count buffs
  consumeQuestBuff();

  saveState();
  triggerGlitch();

  // Toasts
  if (isCrit) {
    state.criticalHits = (state.criticalHits||0) + 1;
    showToast('⚡ COLPO CRITICO! 2X XP','levelup');
  }
  showToast(`${quest.name} — ${modeInfo.icon} ${modeInfo.label}`,'success');
  const timeLbl = quest.timed && timeBonus !== 1.0 ? ` (⏱ x${timeBonus.toFixed(2)})` : '';
  showToast(`+${totalG} XP ${rarity !== 'COMMON' ? `(${RARITY_LABELS[rarity]})` : ''}${timeLbl}`,'xp');
  if (anyLvl) { showToast('LEVEL UP!','levelup'); showLevelUpOverlay(); }

  // Daily bonus loot drop
  if (dailyBonus.questId === quest.id && dailyBonus.bonus === 'LOOT_DROP') {
    const keys = ['XP_CRYSTAL','FOCUS_SHARD','IRON_HEART','LUCKY_CHARM','STAT_CRYSTAL'];
    addBuff(keys[Math.floor(Math.random() * keys.length)]);
  }
  // Daily bonus crit boost
  if (dailyBonus.questId === quest.id && dailyBonus.bonus === 'CRIT_BOOST' && !isCrit) {
    if (Math.random() < 0.5) {
      state.criticalHits = (state.criticalHits||0) + 1;
      const bonus = Math.round(totalG * 0.5);
      state.totalXP += bonus;
      showToast(`⚡ BONUS CRIT! +${bonus} XP extra`, 'xp');
    }
  }

  // Hard mode: chance of extra loot
  if (mode === 'hard' && Math.random() < 0.35) {
    const keys = ['XP_CRYSTAL','FOCUS_SHARD','IRON_HEART','LUCKY_CHARM','STAT_CRYSTAL'];
    addBuff(keys[Math.floor(Math.random() * keys.length)]);
    showToast('🎁 HARD MODE LOOT DROP!','levelup');
  }

  // Chain advancement
  checkChainAdvance(quest.id);
  // Combo check
  checkCombos();
  // Achievement check
  checkAchievements();

  renderQuests();
  renderStatus();
  renderCodex();
  renderGear();
  showSystemPopup({
    tone: 'reward',
    badge: 'SYSTEM',
    title: 'QUEST CLEAR',
    body: 'Missione completata. Il sistema ha aggiornato XP, streak, drop e priorita del Quest Board.',
    sound: 'reward',
  });
}

function getTotalGearPower() {
  return [...PRIMARY_STATS, ...SECONDARY_STATS].reduce((sum, stat) => sum + getEquipmentBonusForStat(stat.id), 0);
}

function getGearRarityClass(rarity) {
  return `gear-rarity-${String(rarity || '').toLowerCase()}`;
}

function getQuestHintIcons(quest) {
  const text = `${quest.desc || ''} ${(quest.protocol || []).join(' ')}`.toLowerCase();
  const hints = [];
  const pushHint = (emoji, motion) => {
    if (hints.some(h => h.emoji === emoji)) return;
    hints.push({ emoji, motion });
  };

  if (quest.timed) pushHint('⏱️', 'pulse');
  if (quest.cat === 'PHYSIQUE') pushHint('🏃', 'float');
  if (quest.cat === 'COGNITIVE') pushHint('📘', 'blink');
  if (quest.cat === 'NEURAL') pushHint('🫁', 'pulse');
  if (quest.cat === 'SOCIAL') pushHint('🗨️', 'sway');
  if (/cold|fredd|ghiacci/.test(text)) pushHint('🧊', 'pulse');
  if (/walk|cammin|run|corsa/.test(text)) pushHint('👣', 'float');
  if (/write|scrivi|journal/.test(text)) pushHint('✍️', 'blink');
  if (/speak|parla|social|chiama/.test(text)) pushHint('📡', 'sway');
  if (/breath|respir|vagal|co2/.test(text)) pushHint('🌬️', 'pulse');

  return hints.slice(0, 3);
}

function awardBossTitle(boss) {
  if (!boss?.titleReward) return false;
  if (!Array.isArray(state.bossTitles)) state.bossTitles = [];
  const alreadyOwned = state.bossTitles.includes(boss.titleReward);
  if (!alreadyOwned) state.bossTitles.push(boss.titleReward);
  state.activeBossTitle = boss.titleReward;
  return !alreadyOwned;
}

function getStatCodexGuide(statId) {
  const guides = {
    STR: { role: 'Forza di output e carico meccanico.', raisedBy: 'strength, iron_heart_forge, pull_up_gauntlet' },
    AGI: { role: 'Velocita, precisione motoria e footwork.', raisedBy: 'sprint_intervals, stalker_boots_run, vestibular' },
    INT: { role: 'Analisi, pattern recognition e problem solving.', raisedBy: 'deep_work, monarch_helm_scan, strategic_reading' },
    VIT: { role: 'Recupero, disponibilita energetica e tenuta di base.', raisedBy: 'crimson_flask_brew, cardio_hiit, endurance_run' },
    CHA: { role: 'Presenza, chiarezza sociale e leadership percepita.', raisedBy: 'social_exposure, lucid_ring_alpha, public_speaking' },
    WIL: { role: 'Volonta, stabilita sotto attrito e continuita.', raisedBy: 'meditation, shadow_recurve_trial, core_bind_belt' },
    VAG: { role: 'Freno vagale e recupero autonomico.', raisedBy: 'vagal_reset, vagal_amulet_recovery, azure_flask_sync' },
    CO2: { role: 'Tolleranza respiratoria e calma sotto pressione.', raisedBy: 'box_breathing, co2_loop_dive, cold_exposure' },
    FOC: { role: 'Focus sostenuto e resistenza alle distrazioni.', raisedBy: 'deep_work, quiver_zero_protocol, azure_flask_sync' },
    DIS: { role: 'Disciplina esecutiva e chiusura dei task.', raisedBy: 'quiver_zero_protocol, deep_work, perfection routing' },
    EMP: { role: 'Regolazione relazionale e lettura degli altri.', raisedBy: 'empathy_training, vagal_amulet_recovery, social_exposure' },
    LEA: { role: 'Guida, responsabilita e impatto sul gruppo.', raisedBy: 'public_speaking, social_exposure, leadership loops' },
    RES: { role: 'Resilienza al carico e resistenza generale.', raisedBy: 'iron_heart_forge, cardio_hiit, endurance_run' },
    ADA: { role: 'Adattamento rapido e flessibilita strategica.', raisedBy: 'creative_block, stalker_boots_run, sprint_intervals' },
    RSL: { role: 'Recupero mentale e ritorno allo stato utile.', raisedBy: 'meditation, crimson_flask_brew, vagal_reset' },
    CRE: { role: 'Divergenza, immaginazione e soluzioni nuove.', raisedBy: 'creative_block, strategic_reading, memory_palace' },
  };
  return guides[statId] || { role: 'Stat di supporto alla build.', raisedBy: 'Quest coerenti con la categoria della stat' };
}

const CODEX_TAB_DEFS = [
  { id:'system', label:'SYSTEM' },
  { id:'stats', label:'STAT RULES' },
  { id:'boss', label:'BOSS RULES' },
  { id:'loot', label:'LOOT FLOW' },
  { id:'set', label:'SET & FORGE' },
  { id:'legacy', label:'LEGACY' },
];

function renderCodex() {
  const tabsEl = $('codexTabs');
  const contentEl = $('codexContent');
  if (!tabsEl || !contentEl) return;

  const activeTab = CODEX_TAB_DEFS.some(tab => tab.id === state.codexTab) ? state.codexTab : 'system';
  const guideCards = `
    <div class="codex-card">
      <div class="codex-card-title">COME ORIENTARTI NEL SISTEMA</div>
      <div class="codex-card-copy"><strong>Status</strong> serve per decidere cosa fare oggi. <strong>Profile</strong> serve per leggere chi sei, come stai costruendo la build e quali target hai. <strong>Codex</strong> spiega le regole. <strong>Guide</strong> ti aiuta a usare tutto questo nel momento giusto.</div>
      <div class="codex-chip-list">
        <span class="codex-chip">Status = oggi</span>
        <span class="codex-chip">Profile = build</span>
        <span class="codex-chip">Codex = regole</span>
        <span class="codex-chip">Guide = supporto</span>
      </div>
    </div>
    <div class="codex-card">
      <div class="codex-card-title">FLOW BASE DEL GIOCO</div>
      <div class="codex-card-copy">Fai lo scan, scegli la missione, chiudi la checklist, raccogli XP, materiali e possibili drop. Quando la build sale, entri in quest speciali, boss, forge e set bonus.</div>
    </div>`;

  const codexPages = {
    system: `
      ${guideCards}
      <div class="codex-card">
        <div class="codex-card-title">RANK PROTOCOL</div>
        <div class="codex-card-copy">Hunter Rank è il livello globale dell'account. Parte dalla build iniziale e poi cresce solo con output reale: quest chiuse, boss sconfitti, reward raccolte e progressione equip. Class Sync misura quanto la tua build attuale assomiglia alla classe assegnata.</div>
        <div class="codex-chip-list">
          <span class="codex-chip">Assessment apre la build</span>
          <span class="codex-chip">Quest alzano stat e rank</span>
          <span class="codex-chip">Boss sbloccano reward rare</span>
          <span class="codex-chip">Gear moltiplica la build</span>
        </div>
      </div>
      <div class="codex-card">
        <div class="codex-card-title">LOOP DI PROGRESSIONE</div>
        <div class="codex-list">
          <div class="codex-row">
            <div>
              <div class="codex-row-title">Daily loop</div>
              <div class="codex-row-copy">Assessment, missione consigliata, completamento checklist e raccolta reward.</div>
            </div>
            <div class="codex-chip">OPS</div>
          </div>
          <div class="codex-row">
            <div>
              <div class="codex-row-title">Build loop</div>
              <div class="codex-row-copy">Stat, titoli, fazioni, gear e set bonus cambiano il valore reale della build.</div>
            </div>
            <div class="codex-chip">BUILD</div>
          </div>
          <div class="codex-row">
            <div>
              <div class="codex-row-title">Endgame loop</div>
              <div class="codex-row-copy">Boss, drop unici, forge e Legacy trasformano la progressione da giornaliera a lunga durata.</div>
            </div>
            <div class="codex-chip">ENDGAME</div>
          </div>
        </div>
      </div>`,
    stats: `
      <div class="codex-card">
        <div class="codex-card-title">STAT RULES</div>
        <div class="codex-card-copy">Le stat definiscono il tipo di output che la build riesce a reggere. Le Primary descrivono l'identità del personaggio. Le Secondary modulano controllo, recupero e precisione.</div>
        <div class="codex-list">
          ${[...PRIMARY_STATS, ...SECONDARY_STATS].map(stat => {
            const guide = getStatCodexGuide(stat.id);
            return `
            <div class="codex-row">
              <div>
                <div class="codex-row-title">${stat.icon} ${stat.name}</div>
                <div class="codex-row-copy">${guide.role}</div>
                <div class="codex-chip-list"><span class="codex-chip">Alza con ${guide.raisedBy}</span></div>
              </div>
              <div class="codex-chip">${PRIMARY_STATS.some(entry => entry.id === stat.id) ? 'PRIMARY' : 'SECONDARY'}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`,
    boss: `
      <div class="codex-card">
        <div class="codex-card-title">BOSS RULES</div>
        <div class="codex-card-copy">Ogni boss rappresenta un pattern comportamentale. Lo sblocchi quando la build soddisfa i requisiti, e lo chiudi eseguendo un protocollo invece di subirlo.</div>
        <div class="codex-list">
          ${BOSS_DEFINITIONS.map(boss => {
            const bossDrop = (BOSS_DROP_TABLES[boss.id] || [])[0];
            const dropItem = bossDrop ? EQUIPMENT_CATALOG[bossDrop.itemId] : null;
            const upgrade = BOSS_SET_UPGRADES[boss.id];
            return `
              <div class="codex-row">
                <div>
                  <div class="codex-row-title">${boss.icon} ${boss.name}</div>
                  <div class="codex-row-copy">${boss.title} · ${boss.emotionLabel}. Requisiti: ${boss.req.map(req => `${req.stat} ${req.minLv}`).join(' · ')}.</div>
                  <div class="codex-chip-list">
                    <span class="codex-chip">Titolo ${boss.titleReward}</span>
                    ${dropItem ? `<span class="codex-chip">DROP ${dropItem.icon} ${getItemDisplayName(dropItem)}</span>` : ''}
                    ${upgrade ? `<span class="codex-chip">SET ${EQUIPMENT_SET_BONUSES[upgrade.setId]?.name || upgrade.setId} · ${Object.entries(upgrade.bonuses).map(([stat, amount]) => `+${amount} ${stat}`).join(' · ')}</span>` : ''}
                  </div>
                </div>
                <div class="codex-chip">BOSS</div>
              </div>`;
          }).join('')}
        </div>
      </div>`,
    loot: `
      <div class="codex-card">
        <div class="codex-card-title">LOOT FLOW</div>
        <div class="codex-card-copy">Le Special Quest aprono gli item di base e le loro varianti. I boss aggiungono reliquie uniche e upgrade permanenti ai set.</div>
        <div class="codex-list">
          ${SPECIAL_QUESTS.map(quest => `
            <div class="codex-row">
              <div>
                <div class="codex-row-title">${quest.icon} ${quest.name}</div>
                <div class="codex-row-copy">${quest.desc} · Req ${quest.req.map(req => `${req.stat} ${req.minLv}`).join(' · ') || 'nessuno'}</div>
                <div class="codex-chip-list">
                  ${(SPECIAL_QUEST_LOOT_TABLES[quest.id] || [{ itemId: quest.equipmentId, weight: 100 }]).map(entry => {
                    const item = EQUIPMENT_CATALOG[entry.itemId];
                    return `<span class="codex-chip">${item?.icon || '✦'} ${getItemDisplayName(item)} · ${entry.weight}%</span>`;
                  }).join('')}
                </div>
              </div>
              <div class="codex-chip">${quest.cat}</div>
            </div>`).join('')}
        </div>
      </div>`,
    set: `
      <div class="codex-card">
        <div class="codex-card-title">SET & FORGE RULES</div>
        <div class="codex-card-copy">I set concedono bonus a soglia. La forge alza il valore dei singoli item. I boss possono aggiungere bonus permanenti extra allo stesso set.</div>
        <div class="codex-list">
          ${Object.entries(EQUIPMENT_SET_BONUSES).map(([setId, setDef]) => {
            const material = MATERIAL_CATALOG[SET_PRIMARY_MATERIAL[setId]];
            return `
              <div class="codex-row">
                <div>
                  <div class="codex-row-title">${setDef.icon} ${setDef.name}</div>
                  <div class="codex-row-copy">${Object.entries(setDef.thresholds).map(([threshold, stats]) => `${threshold}p: ${Object.entries(stats).map(([stat, amount]) => `+${amount} ${stat}`).join(' · ')}`).join(' | ')}</div>
                  <div class="codex-chip-list">
                    <span class="codex-chip">Forge ${material?.icon || '✦'} ${material?.name || 'Materiale'}</span>
                    <span class="codex-chip">Boss upgrade possibili</span>
                  </div>
                </div>
                <div class="codex-chip">SET</div>
              </div>`;
          }).join('')}
        </div>
      </div>`,
    legacy: (() => {
      const completed = LEGACY_100_LIST.filter((_, index) => !!state.bucketListChecks?.[index]).length;
      return `
        <div class="codex-card">
          <div class="codex-card-title">LEGACY: 100 COSE DA FARE PRIMA DI MORIRE</div>
          <div class="codex-card-copy">Spunta una voce alla volta. Questa pagina diventa il tuo endgame fuori dalle quest giornaliere.</div>
          <div class="legacy-progress">
            <span>Progressione Legacy</span>
            <strong>${completed} / ${LEGACY_100_LIST.length}</strong>
          </div>
          <div class="legacy-list">
            ${LEGACY_100_LIST.map((item, index) => `
              <label class="legacy-item ${state.bucketListChecks?.[index] ? 'done' : ''}">
                <input type="checkbox" data-legacy-index="${index}" ${state.bucketListChecks?.[index] ? 'checked' : ''}>
                <span class="legacy-item-label">${index + 1}. ${item}</span>
              </label>
            `).join('')}
          </div>
        </div>`;
    })(),
  };

  tabsEl.innerHTML = CODEX_TAB_DEFS.map(tab => `<button class="codex-tab ${tab.id === activeTab ? 'active' : ''}" data-codex-tab="${tab.id}">${tab.label}</button>`).join('');
  contentEl.innerHTML = codexPages[activeTab] || codexPages.system;

  tabsEl.querySelectorAll('[data-codex-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.codexTab = btn.dataset.codexTab;
      saveState();
      renderCodex();
    });
  });

  contentEl.querySelectorAll('[data-legacy-index]').forEach(input => {
    input.addEventListener('change', () => {
      if (!state.bucketListChecks || typeof state.bucketListChecks !== 'object') state.bucketListChecks = {};
      state.bucketListChecks[input.dataset.legacyIndex] = input.checked;
      saveState();
      renderCodex();
    });
  });
}

function renderGear() {
  const powerEl = $('gearPowerValue');
  const descEl = $('gearPowerDesc');
  const unlockFeatureEl = $('gearUnlockFeature');
  const unlockPreviewEl = $('gearUnlockPreviewList');
  const blueprintEl = $('gearBlueprintList');
  const setListEl = $('gearSetList');
  const materialsEl = $('gearMaterialsList');
  const slotsEl = $('gearSlotsGrid');
  const inventoryEl = $('gearInventoryList');
  const consumablesEl = $('gearConsumablesList');
  if (!powerEl || !descEl || !unlockFeatureEl || !unlockPreviewEl || !blueprintEl || !setListEl || !materialsEl || !slotsEl || !inventoryEl || !consumablesEl) return;

  const totalPower = getTotalGearPower();
  const equippedCount = Object.values(state.equippedGear || {}).filter(Boolean).length;
  const unlockPreviewEntries = getItemUnlockPreviewEntries(3);
  const closestUnlock = unlockPreviewEntries[0] || null;
  powerEl.textContent = `+${totalPower}`;
  descEl.textContent = totalPower
    ? `${equippedCount}/${EQUIPMENT_SLOTS.length} slot attivi. Bonus item e set gia applicati ai requisiti e ai livelli mostrati.`
    : closestUnlock
      ? `Armory attiva ma ancora in avvio. Il prossimo reward reale e ${closestUnlock.item.icon} ${closestUnlock.item.name}: ${closestUnlock.progressState.statusLabel.toLowerCase()}.`
      : 'Completa le quest speciali per riempire il loadout e sbloccare bonus progressivi di set.';

  unlockFeatureEl.innerHTML = renderGearUnlockFeature(closestUnlock);
  unlockPreviewEl.innerHTML = unlockPreviewEntries.length ? unlockPreviewEntries.map(entry => {
    const best = entry.bestSource;
    const unlockState = entry.progressState;
    return `
      <article class="gear-unlock-card gear-linked-preview ${entry.nearUnlock ? 'near-unlock' : ''}" data-armory-quest-id="${best.questId}" tabindex="0" role="button" aria-label="Apri la missione ${escapeHtml(best.questName)} nel Quest Board">
        <div class="gear-unlock-card-top">
          <div class="gear-item-head">
            <div class="gear-item-icon">${entry.item.icon}</div>
            <div>
              <div class="gear-item-name">${escapeHtml(entry.item.name)}</div>
              <div class="gear-item-rarity ${getGearRarityClass(entry.item.rarity)}">${entry.item.rarity} · ${escapeHtml(EQUIPMENT_SLOT_LABELS[entry.item.slot])}</div>
            </div>
          </div>
          <div class="gear-unlock-status ${unlockState.badgeClass}">${unlockState.badge}</div>
        </div>
        ${unlockState.showTrack ? `<div class="gear-unlock-track"><span style="width:${entry.progressPct}%"></span></div>` : ''}
        <div class="gear-unlock-progress-label">${escapeHtml(unlockState.progressLabel)}</div>
        ${renderArmorySourceLine(entry, 'compact')}
        <div class="gear-unlock-contrib">${escapeHtml(unlockState.copy)}</div>
        <div class="gear-unlock-missing">${escapeHtml(unlockState.missingLine)}</div>
      </article>`;
  }).join('') : '<div class="gear-empty-state">Tutti i preview mission-based sono gia stati riscattati. Ora la crescita passa da forge, boss drop e set upgrade.</div>';

  blueprintEl.innerHTML = EQUIPMENT_SLOTS.map(slot => {
    const equippedItem = getEquippedItem(slot);
    const sourceQuests = getSlotBlueprintQuests(slot);
    const slotPreview = getSlotUnlockPreview(slot, unlockPreviewEntries);
    const sourceText = sourceQuests.length
      ? sourceQuests.map(quest => `${quest.icon} ${quest.name}`).join(' · ')
      : 'Slot alimentato da boss drop o varianti avanzate.';
    return `
      <div class="gear-blueprint-card ${equippedItem ? 'active' : ''} ${!equippedItem && slotPreview ? 'gear-linked-preview' : ''}" ${!equippedItem && slotPreview ? `data-armory-quest-id="${slotPreview.bestSource.questId}" tabindex="0" role="button" aria-label="Apri la missione ${escapeHtml(slotPreview.bestSource.questName)} nel Quest Board"` : ''}>
        <div class="gear-blueprint-slot">${EQUIPMENT_SLOT_LABELS[slot]}</div>
        <div class="gear-blueprint-state">${equippedItem ? `${equippedItem.icon} ${getItemDisplayName(equippedItem)}` : slotPreview ? `${slotPreview.item.icon} ${slotPreview.item.name}` : 'Slot vuoto'}</div>
        <div class="gear-blueprint-source">${equippedItem ? sourceText : slotPreview ? `${slotPreview.progressState.blueprintState} · ${slotPreview.bestSource.questIcon} ${slotPreview.bestSource.questName}` : sourceText}</div>
        ${!equippedItem && slotPreview ? renderArmorySourceLine(slotPreview, 'compact') : ''}
      </div>`;
  }).join('');

  const setCounts = getEquippedSetCounts();
  setListEl.innerHTML = Object.entries(EQUIPMENT_SET_BONUSES).map(([setId, setDef]) => {
    const count = setCounts[setId] || 0;
    const upgrades = state.setUpgrades?.[setId] || {};
    const bonuses = Object.entries(setDef.thresholds).map(([threshold, stats]) => {
      const active = count >= Number(threshold);
      return `<div class="gear-set-threshold ${active ? 'active' : ''}">${active ? '✓' : '○'} ${threshold}p · ${Object.entries(stats).map(([stat, val]) => `+${val} ${stat}`).join(' · ')}</div>`;
    }).join('');
    const upgradeLine = Object.keys(upgrades).length
      ? `<div class="gear-set-threshold active">⬆ boss upgrade · ${Object.entries(upgrades).map(([stat, val]) => `+${val} ${stat}`).join(' · ')}</div>`
      : '';
    return `
      <div class="gear-set-card ${count ? 'active' : ''}">
        <div class="gear-set-head">
          <div class="gear-set-name">${setDef.icon} ${setDef.name}</div>
          <div class="gear-set-count">${count} / 4</div>
        </div>
        <div class="gear-set-bonuses">${bonuses}${upgradeLine}</div>
      </div>`;
  }).join('');

  materialsEl.innerHTML = Object.values(MATERIAL_CATALOG).map(material => `
    <div class="gear-material-card">
      <div class="gear-material-name">${material.icon} ${material.name}</div>
      <div class="gear-material-count">${state.materials?.[material.id] || 0}</div>
      <div class="gear-material-desc">${material.desc}</div>
    </div>`).join('');

  slotsEl.innerHTML = EQUIPMENT_SLOTS.map(slot => {
    const item = getEquippedItem(slot);
    const slotPreview = getSlotUnlockPreview(slot, unlockPreviewEntries);
    const itemBonuses = getItemBonuses(item);
    const upgradeLevel = item ? getItemUpgradeLevel(item.id) : 0;
    const bonuses = item
      ? Object.entries(itemBonuses).map(([stat,val]) => `<span class="gear-bonus-pill">+${val} ${stat}</span>`).join('')
      : '';
    return `
      <div class="gear-slot-card ${item ? 'equipped' : 'empty'}" data-slot="${slot}">
        <div class="gear-slot-label">${EQUIPMENT_SLOT_LABELS[slot]}</div>
        ${item ? `
          <div class="gear-item-head">
            <div class="gear-item-icon">${item.icon}</div>
            <div>
              <div class="gear-item-name">${getItemDisplayName(item)}</div>
              <div class="gear-item-rarity ${getGearRarityClass(item.rarity)}">${item.rarity}</div>
            </div>
          </div>
          <div class="gear-item-desc">${item.desc}</div>
          <div class="gear-item-bonuses">${bonuses}</div>
          <div class="gear-slot-meta">${EQUIPMENT_SET_BONUSES[item.set]?.icon || '✦'} ${EQUIPMENT_SET_BONUSES[item.set]?.name || 'Set libero'}${upgradeLevel ? ` · FORGE +${upgradeLevel}` : ''}</div>
          <button class="btn ghost" data-unequip-slot="${slot}">Rimuovi</button>` : `
            <div class="gear-slot-empty ${slotPreview?.nearUnlock ? 'near-unlock' : ''} ${slotPreview ? 'gear-linked-preview' : ''}" ${slotPreview ? `data-armory-quest-id="${slotPreview.bestSource.questId}" tabindex="0" role="button" aria-label="Apri la missione ${escapeHtml(slotPreview.bestSource.questName)} nel Quest Board"` : ''}>
              ${slotPreview ? `
                <div class="gear-slot-preview-head">
                  <strong>${slotPreview.item.icon} ${escapeHtml(slotPreview.item.name)}</strong>
                  <span class="gear-slot-preview-badge ${slotPreview.progressState.badgeClass}">${escapeHtml(slotPreview.progressState.slotState)}</span>
                </div>
                ${slotPreview.progressState.showTrack ? `<div class="gear-slot-preview-track"><span style="width:${slotPreview.progressPct}%"></span></div>` : ''}
                <div class="gear-slot-preview-copy">${slotPreview.bestSource.questIcon} ${escapeHtml(slotPreview.bestSource.questName)} · ${escapeHtml(slotPreview.progressState.progressLabel)}</div>
                ${renderArmorySourceLine(slotPreview, 'compact')}
                <div class="gear-slot-preview-copy">${escapeHtml(slotPreview.progressState.missingLine)}</div>
              ` : `Slot vuoto. ${getSlotBlueprintQuests(slot).length ? `Farmalo con ${getSlotBlueprintQuests(slot).map(quest => quest.name).join(' / ')}.` : 'Continua con special quest e boss avanzati per sbloccarlo.'}`}
            </div>`}
      </div>`;
  }).join('');

  const owned = getOwnedEquipmentItems();
  const arsenalItems = owned.filter(item => !isFlaskItem(item.id));
  inventoryEl.innerHTML = arsenalItems.length ? arsenalItems.map(item => {
    const equipped = state.equippedGear?.[item.slot] === item.id;
    const bonuses = Object.entries(getItemBonuses(item)).map(([stat,val]) => `<span class="gear-bonus-pill">+${val} ${stat}</span>`).join('');
    const upgrade = getUpgradeCost(item);
    const canUpgrade = upgrade && hasUpgradeMaterials(upgrade.costs);
    const forgeState = getGearForgeState(item);
    return `
      <div class="gear-card ${equipped ? 'equipped' : ''}">
        <div class="gear-card-top">
          <div class="gear-item-head">
            <div class="gear-item-icon">${item.icon}</div>
            <div>
              <div class="gear-item-name">${getItemDisplayName(item)}</div>
              <div class="gear-item-rarity ${getGearRarityClass(item.rarity)}">${item.rarity} · ${EQUIPMENT_SLOT_LABELS[item.slot]}</div>
            </div>
          </div>
          <div class="gear-item-bonuses">${bonuses}</div>
        </div>
        <div class="gear-item-desc">${item.desc}</div>
        <div class="gear-card-slot">${EQUIPMENT_SET_BONUSES[item.set]?.icon || '✦'} ${EQUIPMENT_SET_BONUSES[item.set]?.name || 'Set libero'}</div>
        <div class="gear-upgrade-row">
          <div class="gear-upgrade-meta">
            <div class="gear-upgrade-label">FORGE ${getItemUpgradeLevel(item.id) >= UPGRADE_MAX_LEVEL ? 'MAX' : `NEXT +${upgrade?.nextLevel || UPGRADE_MAX_LEVEL}`}</div>
            <div class="gear-upgrade-state gear-upgrade-state-${forgeState.tone}">${forgeState.label}</div>
            <div class="gear-upgrade-cost">${upgrade ? formatMaterialCost(upgrade.costs) : 'Potenziamento massimo raggiunto'}</div>
            <div class="gear-upgrade-hint">${forgeState.hint}</div>
          </div>
          <button class="btn ${canUpgrade ? '' : 'ghost'}" data-upgrade-item="${item.id}" ${upgrade ? '' : 'disabled'}>${upgrade ? 'Forge' : 'MAX'}</button>
        </div>
        <div class="gear-card-actions">
          <button class="btn ${equipped ? 'ghost' : ''}" data-equip-item="${item.id}">${equipped ? 'Equipaggiato' : 'Equipaggia'}</button>
        </div>
      </div>`;
  }).join('') : closestUnlock ? `
    <div class="gear-empty-state gear-empty-state-live gear-linked-preview" data-armory-quest-id="${closestUnlock.bestSource.questId}" tabindex="0" role="button" aria-label="Apri la missione ${escapeHtml(closestUnlock.bestSource.questName)} nel Quest Board">
      <div class="gear-empty-title">Il tuo primo reward reale e gia tracciato</div>
      <div class="gear-empty-copy">Nessun arsenale ancora equipaggiato, ma il sistema ha gia agganciato una rotta credibile per evitare uno stato morto.</div>
      <div class="gear-slot-preview-head">
        <strong>${closestUnlock.item.icon} ${escapeHtml(closestUnlock.item.name)}</strong>
        <span class="gear-slot-preview-badge ${closestUnlock.progressState.badgeClass}">${closestUnlock.progressState.slotState}</span>
      </div>
      ${closestUnlock.progressState.showTrack ? `<div class="gear-slot-preview-track"><span style="width:${closestUnlock.progressPct}%"></span></div>` : ''}
      <div class="gear-empty-copy">Missione chiave: ${closestUnlock.bestSource.questIcon} ${escapeHtml(closestUnlock.bestSource.questName)}</div>
      ${renderArmorySourceLine(closestUnlock, 'compact')}
      <div class="gear-empty-copy">${escapeHtml(closestUnlock.progressState.missingLine)}</div>
    </div>` : '<div class="gear-empty-state">Nessun equip ottenuto. Le missioni speciali iniziano a comparire quando alzi le stat richieste.</div>';

  const flaskItems = owned.filter(item => isFlaskItem(item.id));
  consumablesEl.innerHTML = flaskItems.length ? flaskItems.map(item => {
    const effect = FLASK_EFFECTS[item.id];
    const cooldownRemaining = getFlaskCooldownRemaining(item.id);
    const cooldownPct = effect.cooldownMs > 0 ? Math.max(0, Math.min(100, 100 - (cooldownRemaining / effect.cooldownMs) * 100)) : 100;
    const ready = cooldownRemaining <= 0;
    const upgrade = getUpgradeCost(item);
    const canUpgrade = upgrade && hasUpgradeMaterials(upgrade.costs);
    const forgeState = getGearForgeState(item);
    return `
      <div class="gear-consumable-card ${ready ? 'ready' : 'cooldown'}">
        <div class="gear-consumable-top">
          <div class="gear-item-head">
            <div class="gear-item-icon">${item.icon}</div>
            <div>
              <div class="gear-item-name">${getItemDisplayName(item)}</div>
              <div class="gear-item-rarity ${getGearRarityClass(item.rarity)}">${item.rarity} · ${EQUIPMENT_SLOT_LABELS[item.slot]}</div>
            </div>
          </div>
          <button class="btn ${ready ? '' : 'ghost'}" data-use-flask="${item.id}" ${ready ? '' : 'disabled'}>${ready ? 'Usa ora' : 'Cooldown'}</button>
        </div>
        <div class="gear-item-desc">${item.desc}</div>
        <div class="gear-item-bonuses">${Object.entries(getItemBonuses(item)).map(([stat,val]) => `<span class="gear-bonus-pill">+${val} ${stat}</span>`).join('')}</div>
        <div class="gear-consumable-track"><span style="width:${cooldownPct}%"></span></div>
        <div class="gear-consumable-meta">${effect.icon} ${effect.name} · ${ready ? 'READY' : `pronto tra ${formatTimeLeft(cooldownRemaining)}`}</div>
        <div class="gear-upgrade-row">
          <div class="gear-upgrade-meta">
            <div class="gear-upgrade-label">FORGE ${getItemUpgradeLevel(item.id) >= UPGRADE_MAX_LEVEL ? 'MAX' : `NEXT +${upgrade?.nextLevel || UPGRADE_MAX_LEVEL}`}</div>
            <div class="gear-upgrade-state gear-upgrade-state-${forgeState.tone}">${forgeState.label}</div>
            <div class="gear-upgrade-cost">${upgrade ? formatMaterialCost(upgrade.costs) : 'Potenziamento massimo raggiunto'}</div>
            <div class="gear-upgrade-hint">${forgeState.hint}</div>
          </div>
          <button class="btn ${canUpgrade ? '' : 'ghost'}" data-upgrade-item="${item.id}" ${upgrade ? '' : 'disabled'}>${upgrade ? 'Forge' : 'MAX'}</button>
        </div>
      </div>`;
  }).join('') : '<div class="gear-empty-state">Nessun flask trovato. Alcune special quest e alcuni boss possono sbloccarli.</div>';

  slotsEl.querySelectorAll('[data-unequip-slot]').forEach(btn => btn.addEventListener('click', () => unequipItem(btn.dataset.unequipSlot)));
  inventoryEl.querySelectorAll('[data-equip-item]').forEach(btn => btn.addEventListener('click', () => equipItem(btn.dataset.equipItem)));
  consumablesEl.querySelectorAll('[data-use-flask]').forEach(btn => btn.addEventListener('click', () => useFlask(btn.dataset.useFlask)));
  [...inventoryEl.querySelectorAll('[data-upgrade-item]'), ...consumablesEl.querySelectorAll('[data-upgrade-item]')].forEach(btn => btn.addEventListener('click', () => upgradeEquipmentItem(btn.dataset.upgradeItem)));
  [unlockFeatureEl, unlockPreviewEl, blueprintEl, slotsEl, inventoryEl].forEach(root => {
    root.querySelectorAll('[data-armory-quest-id]').forEach(link => {
      const openSourceMission = () => openQuestBoardFromArmory(link.dataset.armoryQuestId);
      link.addEventListener('click', openSourceMission);
      link.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openSourceMission();
      });
    });
  });

  if (_gearCooldownInterval) clearInterval(_gearCooldownInterval);
  if (currentScreen === 'gear' && flaskItems.some(item => getFlaskCooldownRemaining(item.id) > 0)) {
    _gearCooldownInterval = setInterval(() => {
      if (currentScreen !== 'gear') {
        clearInterval(_gearCooldownInterval);
        _gearCooldownInterval = null;
        return;
      }
      renderGear();
    }, 1000);
  }
}

function completeWeeklyQuest(wq) {
  let totalG = 0, anyLvl = false;
  const buffMult = getBuffXPMult();
  for (const rew of wq.rewards) {
    let eff = Math.round(rew.xp * 2.0 * buffMult);
    eff += getBuffBonusXP(rew.stat);
    if (addStatXP(rew.stat, eff)) anyLvl = true;
    totalG += eff;
  }
  state.totalXP += totalG;
  if (!state.weeklyCompleted) state.weeklyCompleted = [];
  state.weeklyCompleted.push(wq.id);
  consumeQuestBuff();
  saveState();
  triggerGlitch();
  showToast(`🏆 WEEKLY: ${wq.name} COMPLETATA!`, 'levelup');
  showToast(`+${totalG} XP`, 'xp');
  if (anyLvl) { showToast('LEVEL UP!','levelup'); showLevelUpOverlay(); }
  // Always drop a buff for weekly
  const keys = ['XP_CRYSTAL','FOCUS_SHARD','IRON_HEART','LUCKY_CHARM'];
  addBuff(keys[Math.floor(Math.random() * keys.length)]);
  checkAchievements();
  renderQuests();
  renderStatus();
}

// ========================
// RENDER: BOSS
// ========================

function renderBossGrid() {
  $('bossListView')?.classList.add('active');
  $('bossFightView')?.classList.remove('active');
  const g = $('bossGrid');
  g.innerHTML = BOSS_DEFINITIONS.map(b => {
    const dead = state.bossesDefeated.includes(b.id);
    const locked = !meetsReq(b.req);
    const campaignPreview = getBossCampaignPreview(b);
    const cls = dead ? 'defeated' : (locked ? 'locked' : '');
    let stHtml;
    if (dead) stHtml = '<span class="bc-status st-dead">☠ SCONFITTO</span>';
    else if (locked) stHtml = '<span class="bc-status st-lock">🔒 LOCKED</span>';
    else stHtml = '<span class="bc-status st-ready">⚔ ENGAGE</span>';
    return `
      <div class="boss-card ${cls}" data-boss-id="${b.id}" data-theme="${b.themeClass || ''}">
        <div class="bc-icon">${b.icon}</div>
        <div class="bc-name">${b.name}</div>
        <div class="bc-lv">LV. ${b.level}</div>
        <div class="bc-emotion">${b.emotionLabel || 'EMOTIONAL SIGNATURE'}</div>
        <div class="bc-quote">“${b.quote || b.desc}”</div>
        <div class="bc-campaign ${campaignPreview.toneClass}">${escapeHtml(campaignPreview.badge)}</div>
        <div class="bc-campaign-copy">${escapeHtml(campaignPreview.copy)}</div>
        ${stHtml}
      </div>`;
  }).join('');

  g.querySelectorAll('.boss-card').forEach(c => {
    c.addEventListener('click', () => handleBossClick(c.dataset.bossId));
  });
}

let activeBoss = null, activeBossHP = 100, activeBossStep = 0, bossTimer = null;

function handleBossClick(bid) {
  const boss = BOSS_DEFINITIONS.find(b=>b.id===bid);
  if (!boss) return;
  if (state.bossesDefeated.includes(bid)) { showToast('Boss già sconfitto','success'); return; }
  if (!meetsReq(boss.req)) { showToast('Requisiti non soddisfatti','alert'); return; }
  startBossFight(boss);
}

function getBossCampaignEffects(boss) {
  if (!boss) return [];
  return Object.entries(BOSS_CAMPAIGN_EFFECTS).flatMap(([sourceBossId, effects]) => {
    if (!state.bossesDefeated.includes(sourceBossId)) return [];
    const sourceBoss = BOSS_DEFINITIONS.find(entry => entry.id === sourceBossId);
    return (effects || [])
      .filter(effect => effect.targetId === boss.id)
      .map(effect => ({
        ...effect,
        sourceBossId,
        sourceBoss,
      }));
  });
}

function getBossCampaignPriorityScore(boss, source = 'strengths') {
  if (!boss) return 0;
  const effects = getBossCampaignEffects(boss);
  if (!effects.length) return 0;
  let score = effects.length * 4;
  if (effects.some(effect => (effect.durationMult || 1) < 1 || !!effect.damageBonus || !!effect.advantage)) score += 3;
  if (effects.some(effect => effect.protocolStep || effect.fastProtocolAdd)) score += 2;
  if (effects.some(effect => effect.bonusRewards?.length || effect.rewardUnlock)) score += 2;
  if (source === 'strengths' && meetsReq(boss.req)) score += 3;
  if (source === 'fears' && effects.some(effect => effect.weaknessReveal)) score += 1;
  return score;
}

function getCampaignEffectTypeLabel(effect) {
  if (!effect) return 'Campaign shift';
  if (effect.type === 'weakness') return 'Weakness revealed';
  if (effect.type === 'protocol') return 'Protocol shortcut';
  if (effect.type === 'reward') return 'Bonus material enabled';
  if (effect.type === 'advantage') return 'Safer engage window';
  return effect.title || 'Campaign shift';
}

function formatCampaignEffectLine(effect) {
  if (!effect) return 'Campaign shift active';
  return `${effect.sourceBoss?.icon || '☠'} ${effect.sourceBoss?.name || effect.sourceBossId} → ${getCampaignEffectTypeLabel(effect)}: ${effect.summary}`;
}

function getBossCampaignPreview(boss) {
  if (!boss) {
    return {
      badge: 'Base Encounter',
      copy: 'Nessuna conseguenza campagna attiva.',
      toneClass: 'empty',
    };
  }

  const incoming = getBossCampaignEffects(boss);
  if (incoming.length) {
    const lead = incoming[0];
    return {
      badge: `Campaign Live ${incoming.length}`,
      copy: `${lead.sourceBoss?.icon || '☠'} ${lead.sourceBoss?.name || lead.sourceBossId}: ${getCampaignEffectTypeLabel(lead)}.`,
      toneClass: 'live',
    };
  }

  if (state.bossesDefeated.includes(boss.id)) {
    const outgoing = getCampaignUnlocksFromVictory(boss.id);
    if (outgoing.length) {
      const lead = outgoing[0];
      return {
        badge: `Victory Echo ${outgoing.length}`,
        copy: `${lead.targetBoss?.icon || '☠'} ${lead.targetBoss?.name || lead.targetId}: ${getCampaignEffectTypeLabel(lead)}.`,
        toneClass: 'echo',
      };
    }
  }

  return {
    badge: 'Base Encounter',
    copy: 'Nessuna conseguenza campagna attiva.',
    toneClass: 'empty',
  };
}

function getCampaignUnlocksFromVictory(bossId) {
  const sourceBoss = BOSS_DEFINITIONS.find(boss => boss.id === bossId);
  return (BOSS_CAMPAIGN_EFFECTS[bossId] || []).map(effect => {
    const targetBoss = BOSS_DEFINITIONS.find(boss => boss.id === effect.targetId);
    return {
      ...effect,
      sourceBoss,
      targetBoss,
    };
  });
}

function buildBossEncounterProtocol(boss, effects) {
  const durationMultiplier = effects.reduce((multiplier, effect) => multiplier * (effect.durationMult || 1), 1);
  const protocol = boss.protocol.map((step, index) => ({
    ...step,
    source: 'base',
    label: step.label || `Protocol ${index + 1}`,
  }));

  effects
    .filter(effect => effect.protocolStep)
    .forEach(effect => {
      const campaignStep = {
        label: effect.protocolStep.label || 'Campaign Branch',
        instr: effect.protocolStep.instr,
        dur: effect.protocolStep.dur || 60,
        source: 'campaign',
        sourceBossId: effect.sourceBossId,
      };
      const insertAfter = Math.max(0, Math.min(protocol.length, effect.protocolStep.insertAfter ?? protocol.length));
      protocol.splice(insertAfter, 0, campaignStep);
    });

  return protocol.map((step, index) => ({
    ...step,
    index: index + 1,
    dur: Math.max(30, Math.round(step.dur * durationMultiplier)),
  }));
}

function getBossActionProfile(boss) {
  const framework = BOSS_ACTION_FRAMEWORK[boss.id] || {};
  const factionId = framework.factionId || null;
  const faction = factionId ? getFactionDefinition(factionId) : null;
  const repGain = framework.repGain || 0;
  const campaignEffects = getBossCampaignEffects(boss);
  const encounterProtocol = buildBossEncounterProtocol(boss, campaignEffects);
  const damageMultiplier = 1 + campaignEffects.reduce((sum, effect) => sum + (effect.damageBonus || 0), 0);
  const tacticalAdvantages = campaignEffects.map(effect => effect.advantage).filter(Boolean);
  const revealedWeaknesses = campaignEffects.map(effect => effect.weaknessReveal).filter(Boolean);
  const bonusRewards = campaignEffects.flatMap(effect => effect.bonusRewards || []);
  const rewardBreakdown = (boss.rewards || []).map(reward => {
    const statDef = [...PRIMARY_STATS, ...SECONDARY_STATS].find(stat => stat.id === reward.stat);
    const effectiveXp = Math.floor(reward.xp * 1.5 * (1 + Math.min(state.currentStreak * 0.05, 0.5)));
    return {
      icon: statDef?.icon || '✦',
      label: statDef?.name || reward.stat,
      xp: effectiveXp,
    };
  });
  const totalXp = rewardBreakdown.reduce((sum, reward) => sum + reward.xp, 0);
  const dropId = (BOSS_DROP_TABLES[boss.id] || [])[0]?.itemId || null;
  const dropItem = dropId ? EQUIPMENT_CATALOG[dropId] : null;
  const setUpgrade = BOSS_SET_UPGRADES[boss.id] || null;
  const setDefinition = setUpgrade ? EQUIPMENT_SET_BONUSES[setUpgrade.setId] : null;
  const unlockEffects = [];

  if (dropItem) unlockEffects.push(`${dropItem.icon || '✦'} ${dropItem.name}`);
  if (setUpgrade) {
    const bonusSummary = Object.entries(setUpgrade.bonuses)
      .map(([stat, amount]) => `+${amount} ${stat}`)
      .join(' · ');
    unlockEffects.push(`${setDefinition?.name || setUpgrade.setId} upgrade${bonusSummary ? ` · ${bonusSummary}` : ''}`);
  }
  if (boss.titleReward) unlockEffects.push(`Titolo ${boss.titleReward}`);
  if (faction && repGain > 0) unlockEffects.push(`${faction.icon || '✦'} ${faction.name} +${repGain} rep`);
  bonusRewards.forEach(reward => {
    const material = MATERIAL_CATALOG[reward.materialId];
    unlockEffects.push(`${material?.icon || '✦'} ${material?.name || reward.materialId} +${reward.amount}`);
  });
  campaignEffects.forEach(effect => {
    if (effect.rewardUnlock) unlockEffects.push(effect.rewardUnlock);
  });

  return {
    trigger: framework.trigger || boss.desc,
    signs: framework.signs || { body: [], thoughts: [], behavior: [] },
    fastProtocol: [...(framework.fastProtocol || boss.protocol.slice(0, 3).map(step => step.instr)), ...campaignEffects.map(effect => effect.fastProtocolAdd).filter(Boolean)],
    extendedProtocolIntro: framework.extendedProtocolIntro || 'Segui l’intera sequenza fino a chiusura del pattern.',
    extendedProtocol: encounterProtocol,
    encounterProtocol,
    rewardBreakdown,
    totalXp,
    faction,
    repGain,
    dropItem,
    setUpgrade,
    setDefinition,
    unlockEffects,
    campaignEffects,
    tacticalAdvantages,
    revealedWeaknesses,
    bonusRewards,
    damageMultiplier,
    victoryCondition: framework.victoryCondition || 'Completa l’intero protocollo e chiudi il fight senza retreat.',
  };
}

function renderBossProtocolSections(boss) {
  const container = $('bossProtocolSections');
  if (!container || !boss) return;
  const profile = getBossActionProfile(boss);
  const signsSection = [
    { title: 'Body', items: profile.signs.body || [] },
    { title: 'Thoughts', items: profile.signs.thoughts || [] },
    { title: 'Behavior', items: profile.signs.behavior || [] },
  ].map(group => `
    <div class="boss-signs-group">
      <div class="boss-signs-label">${group.title}</div>
      <ul class="boss-bullet-list">
        ${group.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </div>
  `).join('');
  const fastProtocol = profile.fastProtocol.map((step, index) => `
    <li>
      <span class="boss-step-index">0${index + 1}</span>
      <span>${escapeHtml(step)}</span>
    </li>
  `).join('');
  const extendedProtocol = profile.extendedProtocol.map(step => `
    <li class="${step.source === 'campaign' ? 'campaign-step' : ''}">
      <span class="boss-step-index">${step.index}</span>
      <span>
        <strong>${escapeHtml(step.label)}</strong>
        <small>${escapeHtml(step.instr)} · ${Math.max(1, Math.round(step.dur / 60))} min</small>
      </span>
    </li>
  `).join('');
  const rewardBreakdown = profile.rewardBreakdown.map(reward => `
    <li>${reward.icon} ${escapeHtml(reward.label)} +${reward.xp} XP</li>
  `).join('');
  const unlockEffects = profile.unlockEffects.map(effect => `<li>${escapeHtml(effect)}</li>`).join('');
  const campaignEffects = profile.campaignEffects.length ? profile.campaignEffects.map(effect => `
    <div class="boss-campaign-card">
      <div class="boss-campaign-head">
        <span class="boss-campaign-type">${escapeHtml(effect.title || 'Campaign Effect')}</span>
        <span class="boss-campaign-source">${escapeHtml(effect.sourceBoss?.icon || '☠')} ${escapeHtml(effect.sourceBoss?.name || effect.sourceBossId)}</span>
      </div>
      <div class="boss-campaign-copy">${escapeHtml(effect.summary || 'La campagna ha modificato questo scontro.')}</div>
      <div class="boss-campaign-why">Perché: ${escapeHtml(effect.why || 'Una vittoria precedente ha cambiato questo encounter.')}</div>
    </div>
  `).join('') : '<div class="boss-campaign-empty">Nessuna vittoria precedente sta modificando questo scontro. Il protocollo e nella sua forma base.</div>';
  const advantageItems = profile.tacticalAdvantages.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const weaknessItems = profile.revealedWeaknesses.map(item => `<li>${escapeHtml(item)}</li>`).join('');

  container.innerHTML = `
    <section class="boss-protocol-section boss-trigger-section">
      <div class="boss-section-kicker">1. Trigger</div>
      <h3>Quando appare</h3>
      <p>${escapeHtml(profile.trigger)}</p>
    </section>
    <section class="boss-protocol-section boss-signs-section">
      <div class="boss-section-kicker">2. Signs</div>
      <h3>Segni in body, thoughts e behavior</h3>
      <div class="boss-signs-grid">${signsSection}</div>
    </section>
    <section class="boss-protocol-section boss-fast-section">
      <div class="boss-section-kicker">3. Fast Protocol</div>
      <h3>Tre mosse immediate</h3>
      <ol class="boss-step-list boss-step-list-fast">${fastProtocol}</ol>
    </section>
    <section class="boss-protocol-section boss-extended-section">
      <div class="boss-section-kicker">4. Extended Protocol</div>
      <h3>Sequenza completa</h3>
      <p>${escapeHtml(profile.extendedProtocolIntro)}</p>
      <ol class="boss-step-list">${extendedProtocol}</ol>
    </section>
    <section class="boss-protocol-section boss-campaign-section">
      <div class="boss-section-kicker">5. Campaign Effects</div>
      <h3>Come le vittorie precedenti hanno cambiato questo fight</h3>
      <div class="boss-campaign-grid">${campaignEffects}</div>
      ${advantageItems || weaknessItems ? `
        <div class="boss-campaign-meta">
          ${advantageItems ? `<div><div class="boss-reward-label">Tactical Advantages</div><ul class="boss-bullet-list">${advantageItems}</ul></div>` : ''}
          ${weaknessItems ? `<div><div class="boss-reward-label">Hidden Weaknesses Revealed</div><ul class="boss-bullet-list">${weaknessItems}</ul></div>` : ''}
        </div>
      ` : ''}
    </section>
    <section class="boss-protocol-section boss-reward-section">
      <div class="boss-section-kicker">6. Reward</div>
      <h3>Cosa sblocchi vincendo</h3>
      <div class="boss-reward-grid">
        <div>
          <div class="boss-reward-label">XP</div>
          <ul class="boss-bullet-list">${rewardBreakdown}<li><strong>Totale +${profile.totalXp} XP</strong></li></ul>
        </div>
        <div>
          <div class="boss-reward-label">Core Reward</div>
          <ul class="boss-bullet-list">
            <li>🜂 BOSS CORE x2</li>
            ${profile.repGain > 0 && profile.faction ? `<li>${profile.faction.icon || '✦'} ${escapeHtml(profile.faction.name)} +${profile.repGain} reputation</li>` : ''}
          </ul>
        </div>
        <div>
          <div class="boss-reward-label">Unlock Effects</div>
          <ul class="boss-bullet-list">${unlockEffects || '<li>Nessun unlock extra</li>'}</ul>
        </div>
      </div>
    </section>
    <section class="boss-protocol-section boss-victory-section">
      <div class="boss-section-kicker">7. Victory Condition</div>
      <h3>Quando la run conta davvero</h3>
      <p>${escapeHtml(profile.victoryCondition)}</p>
    </section>
  `;
}

function startBossFight(boss) {
  activeBoss = boss;
  const profile = getBossActionProfile(boss);
  activeBossHP = 100;
  activeBossStep = 0;
  $('bossListView').classList.remove('active');
  $('bossFightView').classList.add('active');
  $('bossFightView').dataset.bossTheme = boss.themeClass || '';
  $('bossFightSigil').textContent = boss.icon || '💀';
  const n = $('bossFightName');
  n.textContent = boss.name;
  n.dataset.text = boss.name;
  $('bossFightEmotion').textContent = boss.emotionLabel || 'EMOTIONAL SIGNATURE';
  $('bossFightLore').textContent = boss.desc;
  $('bossFightQuote').textContent = `“${boss.quote || ''}”`;
  const banner = $('bossCampaignBanner');
  if (banner) {
    banner.classList.remove('hidden');
    banner.classList.toggle('active', profile.campaignEffects.length > 0);
    banner.innerHTML = profile.campaignEffects.length
      ? `<div class="boss-campaign-banner-kicker">CAMPAIGN SHIFT</div><div class="boss-campaign-banner-copy">${profile.campaignEffects.length} effetti attivi da vittorie precedenti. Questo encounter ha protocollo, finestra e reward parzialmente alterati.</div><div class="boss-campaign-banner-list">${profile.campaignEffects.slice(0, 3).map(effect => `<div class="boss-campaign-banner-row">${escapeHtml(formatCampaignEffectLine(effect))}</div>`).join('')}</div>`
      : '<div class="boss-campaign-banner-kicker">BASE ENCOUNTER</div><div class="boss-campaign-banner-copy">Nessuna vittoria precedente sta alterando questo boss. Affronti il protocollo originale.</div>';
  }
  renderBossProtocolSections(boss);
  updateBossHP();
  loadBossStep();
  triggerGlitch();
}

function updateBossHP() {
  $('bossHpPct').textContent = Math.max(0,Math.round(activeBossHP));
  $('bossHpFill').style.width = Math.max(0,activeBossHP)+'%';
}

function loadBossStep() {
  if (!activeBoss) return;
  const profile = getBossActionProfile(activeBoss);
  const step = profile.encounterProtocol[activeBossStep];
  if (!step) return;
  $('protocolLbl').textContent = `Step ${activeBossStep+1}/${profile.encounterProtocol.length}`;
  $('protocolInstr').textContent = step.instr;
  $('btnExec').disabled = false;
  $('btnExec').textContent = 'ESEGUI STEP';
  resetTimer(step.dur);
}

function resetTimer(secs) {
  const prog = $('timerProg');
  const circ = 2 * Math.PI * 54;
  prog.style.strokeDasharray = circ;
  prog.style.strokeDashoffset = '0';
  $('timerVal').textContent = fmtTime(secs);
}

function fmtTime(s) {
  const m = Math.floor(s/60);
  return `${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

function startTimer(total, cb) {
  const prog = $('timerProg');
  const circ = 2 * Math.PI * 54;
  let rem = total;
  $('btnExec').disabled = true;
  $('btnExec').textContent = 'IN CORSO...';
  bossTimer = setInterval(() => {
    rem--;
    prog.style.strokeDashoffset = `${circ * (1 - rem/total)}`;
    $('timerVal').textContent = fmtTime(rem);
    if (rem <= 0) { clearInterval(bossTimer); bossTimer = null; cb(); }
  }, 1000);
}

$('btnExec').addEventListener('click', () => {
  if (!activeBoss || bossTimer) return;
  const profile = getBossActionProfile(activeBoss);
  const step = profile.encounterProtocol[activeBossStep];
  if (!step) return;
  startTimer(step.dur, () => {
    const dmg = (100 / profile.encounterProtocol.length) * profile.damageMultiplier;
    activeBossHP -= dmg;
    updateBossHP();
    triggerGlitch();
    if (activeBossHP <= 0) { defeatBoss(); }
    else {
      activeBossStep++;
      if (activeBossStep < profile.encounterProtocol.length) loadBossStep();
      else { activeBossHP = 0; updateBossHP(); defeatBoss(); }
    }
  });
});

$('btnRetreat').addEventListener('click', () => {
  if (bossTimer) { clearInterval(bossTimer); bossTimer = null; }
  activeBoss = null;
  $('bossProtocolSections').innerHTML = '';
  $('bossCampaignBanner')?.classList.add('hidden');
  $('bossFightView').dataset.bossTheme = '';
  $('bossFightSigil').textContent = '💀';
  $('bossFightView').classList.remove('active');
  $('bossListView').classList.add('active');
  renderBossGrid();
});

function defeatBoss() {
  if (!activeBoss) return;
  const boss = activeBoss;
  const bossProfile = getBossActionProfile(boss);
  let totalXP = 0, anyLvl = false;
  for (const rew of boss.rewards) {
    const eff = Math.floor(rew.xp * 1.5 * (1+Math.min(state.currentStreak*0.05, 0.5)));
    if (addStatXP(rew.stat, eff)) anyLvl = true;
    totalXP += eff;
  }
  state.totalXP += totalXP;
  if (!state.bossesDefeated.includes(boss.id)) {
    state.bossesDefeated.push(boss.id);
  }
  const unlockedNewTitle = awardBossTitle(boss);

  const bossDrop = rollLootTable(BOSS_DROP_TABLES[boss.id] || []);
  if (bossDrop) awardEquipment(bossDrop);
  const setUpgrade = BOSS_SET_UPGRADES[boss.id];
  if (setUpgrade) grantSetUpgrade(setUpgrade.setId, setUpgrade.bonuses, boss.name);
  awardMaterial('BOSS_CORE', 2, boss.name);
  bossProfile.bonusRewards.forEach(reward => awardMaterial(reward.materialId, reward.amount, `${boss.name} Campaign Cache`));
  if (bossProfile.faction && bossProfile.repGain > 0) addFactionRep(bossProfile.faction.id, bossProfile.repGain);
  saveState();

  // Show rewards
  const rewLines = boss.rewards.map(r => {
    const s = [...PRIMARY_STATS,...SECONDARY_STATS].find(s=>s.id===r.stat);
    const eff = Math.floor(r.xp * 1.5 * (1+Math.min(state.currentStreak*0.05, 0.5)));
    return `${s?.icon||''} ${s?.name||r.stat}: +${eff} XP`;
  }).join('<br>');
  const bossDropLine = bossDrop ? `<br><br><strong>DROP:</strong> ${EQUIPMENT_CATALOG[bossDrop]?.icon || '✦'} ${EQUIPMENT_CATALOG[bossDrop]?.name || bossDrop}` : '';
  const setUpgradeLine = setUpgrade ? `<br><strong>UPGRADE SET:</strong> ${EQUIPMENT_SET_BONUSES[setUpgrade.setId]?.name || setUpgrade.setId} · ${Object.entries(setUpgrade.bonuses).map(([stat, amount]) => `+${amount} ${stat}`).join(' · ')}` : '';
  const titleLine = boss.titleReward ? `<br><strong>TITOLO:</strong> ${boss.titleReward}${unlockedNewTitle ? ' · sbloccato e attivo' : ' · attivato'}` : '';
  const factionLine = bossProfile.faction && bossProfile.repGain > 0 ? `<br><strong>REPUTATION:</strong> ${bossProfile.faction.icon || '✦'} ${bossProfile.faction.name} +${bossProfile.repGain}` : '';
  const campaignRewardLine = bossProfile.bonusRewards.length ? `<br><strong>CAMPAIGN CACHE:</strong> ${bossProfile.bonusRewards.map(reward => {
    const material = MATERIAL_CATALOG[reward.materialId];
    return `${material?.icon || '✦'} ${material?.name || reward.materialId} +${reward.amount}`;
  }).join(' · ')}` : '';
  const campaignUnlocks = getCampaignUnlocksFromVictory(boss.id);
  const campaignUnlockLine = campaignUnlocks.length ? `<br><br><strong>CAMPAIGN UNLOCKS:</strong><br>${campaignUnlocks.map(effect => `→ ${effect.targetBoss?.icon || '☠'} ${effect.targetBoss?.name || effect.targetId}: ${effect.summary}`).join('<br>')}` : '';
  const quoteLine = boss.quote ? `<br><br><em>“${boss.quote}”</em>` : '';
  $('defDetail').innerHTML = `${boss.icon} ${boss.name} SCONFITTO!<br><br>${rewLines}<br><br><strong>TOTALE: +${totalXP} XP</strong>${bossDropLine}${setUpgradeLine}${titleLine}${factionLine}${campaignRewardLine}${campaignUnlockLine}${quoteLine}`;
  $('bossDefeatOverlay').classList.remove('hidden');
  triggerGlitch();
  showToast(`☠ ${boss.name} SCONFITTO!`, 'levelup');
  showToast(`+${totalXP} XP`, 'xp');
  if (boss.titleReward) showToast(`👑 Titolo attivo: ${boss.titleReward}`, 'success');
  if (bossProfile.faction && bossProfile.repGain > 0) showToast(`${bossProfile.faction.icon || '✦'} ${bossProfile.faction.name} +${bossProfile.repGain} rep`, 'success');
  if (anyLvl) { showToast('LEVEL UP!','levelup'); showLevelUpOverlay(); }

  // Update status and check achievements
  renderStatus();
  checkAchievements();
  activeBoss = null;
}

$('btnDismissDef').addEventListener('click', () => {
  $('bossDefeatOverlay').classList.add('hidden');
  $('bossProtocolSections').innerHTML = '';
  $('bossCampaignBanner')?.classList.add('hidden');
  $('bossFightView').dataset.bossTheme = '';
  $('bossFightSigil').textContent = '💀';
  $('bossFightView').classList.remove('active');
  $('bossListView').classList.add('active');
  renderBossGrid();
  renderStatus();
});

// ========================
// CUSTOM QUEST SYSTEM
// ========================

let editingQuestId = null;

function openCreateQuestModal(editId) {
  editingQuestId = null;
  const modal = $('customQuestModal');
  if (!modal) return;

  // Populate stat selects
  const allStats = [...PRIMARY_STATS, ...SECONDARY_STATS];
  const statOpts = allStats.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('');
  $('cqRewardStat').innerHTML = statOpts;
  $('cqExtraRewards').innerHTML = '';

  // Reset form
  $('cqName').value = '';
  $('cqDesc').value = '';
  $('cqDiff').value = 5; $('valCqDiff').textContent = '5';
  $('cqDur').value = 15;
  $('cqTimed').checked = false;
  $('cqCat').value = 'COGNITIVE';
  $('cqRewardXp').value = 30; $('valCqRewardXp').textContent = '30';
  $('cqProtocol').value = '';
  $$('.cq-icon-btn').forEach(b => b.classList.remove('selected'));
  const firstIcon = document.querySelector('.cq-icon-btn');
  if (firstIcon) firstIcon.classList.add('selected');

  // If editing, fill values
  if (editId) {
    const q = (state.customQuests || []).find(x => x.id === editId);
    if (q) {
      editingQuestId = editId;
      $('cqName').value = q.name;
      $('cqDesc').value = q.desc;
      $('cqDiff').value = q.diff; $('valCqDiff').textContent = q.diff;
      $('cqDur').value = q.dur;
      $('cqTimed').checked = !!q.timed;
      $('cqCat').value = q.cat;
      if (q.rewards[0]) {
        $('cqRewardStat').value = q.rewards[0].stat;
        $('cqRewardXp').value = q.rewards[0].xp; $('valCqRewardXp').textContent = q.rewards[0].xp;
      }
      $('cqProtocol').value = (q.protocol || []).join('\n');
      $$('.cq-icon-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.icon === q.icon);
      });
      // Extra rewards
      if (q.rewards.length > 1) {
        for (let i = 1; i < q.rewards.length; i++) {
          addExtraRewardRow(q.rewards[i].stat, q.rewards[i].xp);
        }
      }
    }
  }

  modal.classList.remove('hidden');
}

function addExtraRewardRow(stat, xp) {
  const allStats = [...PRIMARY_STATS, ...SECONDARY_STATS];
  const statOpts = allStats.map(s => `<option value="${s.id}" ${s.id === stat ? 'selected' : ''}>${s.icon} ${s.name}</option>`).join('');
  const div = document.createElement('div');
  div.className = 'cq-reward-row cq-extra';
  div.innerHTML = `<select class="onb-select cq-stat-sel cq-extra-stat">${statOpts}</select>
    <div class="onb-slider-row cq-xp-row"><input type="range" class="onb-slider cq-extra-xp" min="10" max="80" value="${xp||20}"><span class="onb-slider-val">${xp||20}</span> XP</div>
    <button class="cq-remove-reward">✕</button>`;
  div.querySelector('.cq-extra-xp').addEventListener('input', e => {
    e.target.nextElementSibling.textContent = e.target.value;
  });
  div.querySelector('.cq-remove-reward').addEventListener('click', () => div.remove());
  $('cqExtraRewards').appendChild(div);
}

function saveCustomQuest() {
  const name = $('cqName').value.trim();
  const desc = $('cqDesc').value.trim();
  if (!name) { showToast('Inserisci un nome', 'alert'); return; }

  const icon = document.querySelector('.cq-icon-btn.selected')?.dataset?.icon || '⭐';
  const cat = $('cqCat').value;
  const diff = parseInt($('cqDiff').value);
  const dur = parseInt($('cqDur').value) || 15;
  const timed = $('cqTimed').checked;
  const rewards = [{ stat: $('cqRewardStat').value, xp: parseInt($('cqRewardXp').value) }];

  // Extra rewards
  $$('.cq-extra').forEach(row => {
    const st = row.querySelector('.cq-extra-stat').value;
    const xp = parseInt(row.querySelector('.cq-extra-xp').value);
    if (st && xp > 0) rewards.push({ stat: st, xp });
  });

  const protocolText = $('cqProtocol').value.trim();
  const protocol = protocolText ? protocolText.split('\n').filter(l => l.trim()) : ['Completa la quest'];

  if (!state.customQuests) state.customQuests = [];

  if (editingQuestId) {
    const idx = state.customQuests.findIndex(q => q.id === editingQuestId);
    if (idx >= 0) {
      state.customQuests[idx] = { ...state.customQuests[idx], name, desc, icon, cat, diff, dur, timed, rewards, protocol };
    }
  } else {
    const id = 'custom_' + Date.now();
    state.customQuests.push({
      id, name, desc, icon, cat, diff, dur, timed, rewards, protocol,
      type: 'DAILY', req: [], science: 'Quest personalizzata.', isCustom: true,
    });
  }

  saveState();
  $('customQuestModal').classList.add('hidden');
  editingQuestId = null;
  showToast(editingQuestId ? 'Quest aggiornata!' : 'Quest creata!', 'success');
  renderQuests();
}

function deleteCustomQuest(id) {
  if (!state.customQuests) return;
  state.customQuests = state.customQuests.filter(q => q.id !== id);
  saveState();
  showToast('Quest eliminata', 'alert');
  renderQuests();
}

function renderCustomQuests() {
  const listEl = $('questList');
  const customs = state.customQuests || [];

  if (customs.length === 0) {
    listEl.innerHTML = `<div class="cq-empty">
      <div class="cq-empty-icon">📋</div>
      <p>Nessuna quest personalizzata.</p>
      <button class="btn-primary" id="btnCreateFirstQuest">＋ CREA LA TUA PRIMA QUEST</button>
    </div>`;
    const btn = $('btnCreateFirstQuest');
    if (btn) btn.addEventListener('click', () => openCreateQuestModal());
    $('qpFill').style.width = '0%';
    $('qpText').textContent = '0 / 0';
    $('totalRewXp').textContent = '0 XP';
    return;
  }

  listEl.innerHTML = customs.map(q => {
    const rank = getRank(q.diff);
    const rarity = getQuestRarity(q.diff);
    const doneInfo = getDoneInfo(q.id);
    const done = !!doneInfo;
    const cls = done ? 'done' : '';
    const rarityTag = `<span class="rarity-badge rarity-${rarity.toLowerCase()}">${RARITY_LABELS[rarity]}</span>`;
    const timedTag = q.timed ? '<span class="timed-tag">⏱ TIMED</span>' : '';
    const customTag = '<span class="custom-tag">✦ CUSTOM</span>';
    const doneModeBadge = doneInfo?.mode ? `<span class="done-mode-badge" style="color:${DIFFICULTY_MODES[doneInfo.mode].color}">${DIFFICULTY_MODES[doneInfo.mode].icon} ${DIFFICULTY_MODES[doneInfo.mode].label}</span>` : '';
    const questHints = renderQuestHintIconsMarkup(q);
    const previewXp = getQuestPreviewXP(q);

    const xpPreview = !done ? `<div class="diff-mode-selector" data-qid="${q.id}">
      ${Object.entries(DIFFICULTY_MODES).map(([k,m]) => {
        return `<button class="diff-mode-btn" data-mode="${k}" data-qid="${q.id}" style="border-color:${m.color}"><span class="dm-icon">${m.icon}</span><span class="dm-label">${m.label}</span><span class="dm-xp">+${getQuestModePreviewXP(q, k)}</span></button>`;
      }).join('')}
    </div>` : '';

    return `
      <div class="quest-card ${cls} rarity-border-${rarity.toLowerCase()}" data-quest-id="${q.id}" data-cat="${q.cat}">
        <div class="q-check">${done ? '✓' : ''}</div>
        <span class="q-icon">${q.icon}</span>
        <div class="q-body">
          <div class="quest-summary-head">
            <div class="quest-summary-main">
              <div class="q-name">${q.name} ${customTag} ${timedTag} ${doneModeBadge}</div>
              <div class="quest-quickline">${buildQuestQuickline(q, { context: 'custom', done })}</div>
            </div>
            <div class="q-rank rk-${rank}">${rank}</div>
          </div>
          <div class="q-tags">${rarityTag}<span class="q-cat-tag">${q.cat}</span></div>
          <div class="quest-summary-grid"><span class="quest-summary-chip">${q.dur} min</span><span class="quest-summary-chip quest-summary-chip-xp">+${previewXp} XP</span><span class="quest-summary-chip">Custom</span></div>
          ${xpPreview}
          ${renderQuestLayerMarkup({
            protocolId: `detail-${q.id}`,
            rationaleId: `why-${q.id}`,
            protocol: q.protocol || [],
            rationale: q.science || q.desc || 'Missione custom definita dal giocatore.',
            hintMarkup: questHints,
            protocolFooter: `<div class="cq-card-actions"><button class="btn-secondary cq-edit-btn" data-id="${q.id}">✏ MODIFICA</button><button class="btn-danger cq-del-btn" data-id="${q.id}">🗑 ELIMINA</button></div>`
          })}
        </div>
      </div>`;
  }).join('');

  const total = customs.length;
  const done = customs.filter(q => getDoneInfo(q.id)).length;
  const pct = total > 0 ? Math.round((done/total)*100) : 0;
  $('qpFill').style.width = pct+'%';
  $('qpText').textContent = `${done} / ${total}`;
  const totalXP = customs.reduce((a,q) => {
    const de = Math.max(1, q.diff);
    const rr = RARITY_MULT[getQuestRarity(de)];
    return a + q.rewards.reduce((b,r) => b + Math.round(calcXP(r.xp, de, state.currentStreak, getDebuffPenalty(r.stat)) * rr), 0);
  }, 0);
  $('totalRewXp').textContent = totalXP + ' XP';

  // Mode button handlers
  listEl.querySelectorAll('.diff-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      startQuestWithMode(btn.dataset.qid, btn.dataset.mode);
    });
  });

  // Edit/delete handlers
  listEl.querySelectorAll('.cq-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openCreateQuestModal(btn.dataset.id); });
  });
  listEl.querySelectorAll('.cq-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteCustomQuest(btn.dataset.id); });
  });

  bindQuestLayerInteractions(listEl);
}

function initCustomQuestModal() {
  $('cqDiff').addEventListener('input', () => { $('valCqDiff').textContent = $('cqDiff').value; });
  $('cqRewardXp').addEventListener('input', () => { $('valCqRewardXp').textContent = $('cqRewardXp').value; });

  $$('.cq-icon-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      $$('.cq-icon-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  $('btnAddReward').addEventListener('click', (e) => { e.preventDefault(); addExtraRewardRow(); });
  $('btnSaveQuest').addEventListener('click', saveCustomQuest);
  $('btnCancelQuest').addEventListener('click', () => {
    $('customQuestModal').classList.add('hidden');
    editingQuestId = null;
  });
}

function updateAvatarPreview(previewId, emoji, color) {
  const preview = $(previewId);
  if (!preview) return;
  preview.textContent = emoji;
  preview.style.background = `linear-gradient(135deg, ${color}, #0a1020)`;
  preview.style.boxShadow = `0 0 24px ${color}55`;
}

function renderAvatarPicker({ emojiContainerId, colorContainerId, previewId, persist = false }) {
  const emojiContainer = $(emojiContainerId);
  const colorContainer = $(colorContainerId);
  if (!emojiContainer || !colorContainer) return;

  const avatar = getAvatarConfig();

  emojiContainer.innerHTML = AVATAR_EMOJI_OPTIONS.map(emoji => `
    <button class="avatar-choice ${avatar.emoji === emoji ? 'selected' : ''}" type="button" data-avatar-emoji="${emoji}">${emoji}</button>
  `).join('');
  colorContainer.innerHTML = AVATAR_COLOR_OPTIONS.map(color => `
    <button class="avatar-color-choice ${avatar.color === color ? 'selected' : ''}" type="button" data-avatar-color="${color}" style="--avatar-color:${color}"></button>
  `).join('');

  updateAvatarPreview(previewId, avatar.emoji, avatar.color);

  emojiContainer.querySelectorAll('[data-avatar-emoji]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.avatarEmoji = btn.dataset.avatarEmoji;
      renderAvatarPicker({ emojiContainerId, colorContainerId, previewId, persist });
      renderUserAvatar(currentUser?.user_metadata || {});
      if (persist) saveState();
    });
  });

  colorContainer.querySelectorAll('[data-avatar-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.avatarColor = btn.dataset.avatarColor;
      renderAvatarPicker({ emojiContainerId, colorContainerId, previewId, persist });
      renderUserAvatar(currentUser?.user_metadata || {});
      if (persist) saveState();
    });
  });
}

let aiConfigAvatarDraft = null;

// ========================
// COMPANION CHAT
// ========================

function getGuideContextScreen() {
  return lastGuideContextScreen || 'status';
}

function getGuideSituationalSnapshot() {
  const context = getGuideContextScreen();
  const latestAssessment = getLatestAssessment();
  const classDef = CLASS_DEFINITIONS.find(entry => entry.id === state.playerClass) || null;
  const topStat = [...PRIMARY_STATS].sort((left, right) => getEffectiveStatLv(right.id) - getEffectiveStatLv(left.id))[0] || null;
  const weakStat = [...PRIMARY_STATS].sort((left, right) => getEffectiveStatLv(left.id) - getEffectiveStatLv(right.id))[0] || null;
  const todayModel = buildTodayCommandModel();
  const profileRecommendations = getProfileRecommendations();
  const activeCodexTab = CODEX_TAB_DEFS.find(tab => tab.id === state.codexTab) || CODEX_TAB_DEFS[0];
  const questTabDef = QUEST_TAB_DEFS.find(tab => tab.id === questTab) || QUEST_TAB_DEFS[0];
  const availableQuests = getAvailableQuests(latestAssessment || null).filter(quest => !getDoneInfo(quest.id));
  const questsInTab = questTabDef?.filter ? availableQuests.filter(questTabDef.filter) : availableQuests;
  const questFocus = todayModel.mission && getQuestTabIdForQuest(todayModel.mission) === questTab ? todayModel.mission : (questsInTab[0] || todayModel.mission || null);
  const unlockPreview = getItemUnlockPreviewEntries(3);
  const armoryLead = unlockPreview[0] || null;
  const forgeCandidate = getOwnedEquipmentItems()
    .map(item => ({ item, forgeState: getGearForgeState(item), upgradeLevel: getItemUpgradeLevel(item.id) }))
    .filter(entry => entry.forgeState.key !== 'maxed')
    .sort((left, right) => Number(left.forgeState.key === 'ready') - Number(right.forgeState.key === 'ready') || left.upgradeLevel - right.upgradeLevel)[0] || null;
  const bossFocus = activeBoss || todayModel.bossDirective?.boss || BOSS_DEFINITIONS.find(boss => !state.bossesDefeated.includes(boss.id) && meetsReq(boss.req)) || null;
  const bossCampaignEffects = bossFocus ? getBossCampaignEffects(bossFocus) : [];

  return {
    context,
    latestAssessment,
    classDef,
    topStat,
    weakStat,
    todayModel,
    profileRecommendations,
    activeCodexTab,
    questTabDef,
    questFocus,
    armoryLead,
    forgeCandidate,
    bossFocus,
    bossCampaignEffects,
  };
}

function buildGuideContextModel() {
  const snapshot = getGuideSituationalSnapshot();
  const { context, todayModel, classDef, topStat, weakStat, activeCodexTab, questTabDef, questFocus, armoryLead, forgeCandidate, bossFocus, bossCampaignEffects } = snapshot;

  const models = {
    status: {
      title: 'Guide = Tactical co-pilot',
      copy: todayModel.scanReady
        ? `Scan locked. Ora conta una sola cosa: ${todayModel.mission ? `${todayModel.mission.icon} ${todayModel.mission.name}` : 'convertire il command in azione'}.${todayModel.campaign?.targetBoss ? ` La campagna sta gia piegando ${todayModel.campaign.targetBoss.icon} ${todayModel.campaign.targetBoss.name}.` : ''}`
        : 'Qui il Guide non riassume la home: ti dice cosa sblocca davvero il Daily Scan e quale mossa viene prima di tutto.',
      explainLabel: 'Explain Status Now',
      prompts: [
        'Decidi tu la mia prossima mossa adesso',
        todayModel.scanReady ? 'Perche il Today Command mi sta mandando proprio su questa missione' : 'Perche senza scan il comando di oggi resta incompleto',
        todayModel.campaign?.targetBoss ? 'Dimmi cosa cambia nel prossimo boss grazie alle vittorie gia fatte' : 'Dimmi se la campagna boss e gia viva oppure no',
        'Leggi rischio boss e reward atteso in modo semplice',
      ],
    },
    profile: {
      title: 'Guide = Build analyst',
      copy: `Qui il Guide legge pattern, priorita e target: ${classDef ? `${classDef.icon} ${classDef.name}` : 'build non assegnata'} · top ${topStat?.name || 'N/D'} · fragilita ${weakStat?.name || 'N/D'}.`,
      explainLabel: 'Explain Build Pattern',
      prompts: [
        'Dimmi il pattern vero della mia build',
        'Quale debolezza mi sta rallentando di piu',
        'Che target ha piu senso per il mio profilo adesso',
      ],
    },
    codex: {
      title: 'Guide = Rule translator',
      copy: `Qui il Guide traduce ${activeCodexTab?.label || 'SYSTEM'} in linguaggio pratico, senza farti leggere il sistema come documentazione.`,
      explainLabel: 'Explain This Rule Set',
      prompts: [
        `Spiegami ${activeCodexTab?.label || 'questa sezione'} in linguaggio umano`,
        'Dimmi cosa conta davvero e cosa posso ignorare',
        'Trasforma queste regole in 3 regole pratiche',
      ],
    },
    quests: {
      title: 'Guide = Mission selector',
      copy: questFocus
        ? `Qui il Guide decide tra tab, missione e difficolta. Focus attuale: ${questFocus.icon} ${questFocus.name}${questTabDef ? ` · tab ${questTabDef.label}` : ''}.`
        : 'Qui il Guide ti aiuta a capire quale missione aprire e quale attrito ridurre prima di partire.',
      explainLabel: 'Explain Mission Choice',
      prompts: [
        'Quale missione dovrei scegliere in questa tab',
        'Che mode mi conviene per la missione di adesso',
        'Riduci la missione giusta a una checklist tattica',
      ],
    },
    gear: {
      title: 'Guide = Unlock co-pilot',
      copy: armoryLead
        ? `Qui il Guide ti dice come convertire ${armoryLead.item.icon} ${armoryLead.item.name} da preview a reward reale.`
        : forgeCandidate
          ? `Qui il Guide ti legge la forge: focus attuale ${forgeCandidate.item.icon} ${getItemDisplayName(forgeCandidate.item)}.`
          : 'Qui il Guide connette preview, forge e mission routing al prossimo item concreto.',
      explainLabel: 'Explain Next Unlock',
      prompts: [
        'Qual e l azione esatta per sbloccare il prossimo item',
        'Dimmi se devo farmare missione o materiali adesso',
        'Spiegami il prossimo upgrade Armory in modo semplice',
      ],
    },
    boss: {
      title: 'Guide = Boss co-pilot',
      copy: bossFocus
        ? `Qui il Guide legge timing e rischio del fight su ${bossFocus.icon} ${bossFocus.name}, non solo la lore del boss.${bossCampaignEffects.length ? ` La campagna ha gia lasciato ${bossCampaignEffects.length} cicatrici utili su questo encounter.` : ''}`
        : 'Qui il Guide decide se un boss va affrontato, evitato o preparato.',
      explainLabel: 'Explain Boss Decision',
      prompts: [
        'Devo ingaggiare o evitare il boss adesso',
        bossCampaignEffects.length ? 'Dimmi quali vantaggi campagna sono gia attivi su questo boss' : 'Dimmi quale vittoria cambiera il prossimo boss',
        'Dimmi la preparazione minima prima del prossimo boss',
        'Riassumi il fight in una sequenza corta e utile',
      ],
    },
  };
  return models[context] || models.status;
}

function buildGuidePageExplanation() {
  const snapshot = getGuideSituationalSnapshot();
  const { context, latestAssessment, classDef, topStat, weakStat, todayModel, profileRecommendations, activeCodexTab, questTabDef, questFocus, armoryLead, forgeCandidate, bossFocus, bossCampaignEffects } = snapshot;
  const topStats = [...PRIMARY_STATS]
    .sort((left, right) => getEffectiveStatLv(right.id) - getEffectiveStatLv(left.id))
    .slice(0, 2)
    .map(stat => `${stat.icon} ${stat.name} LV.${getEffectiveStatLv(stat.id)}`)
    .join(' · ');

  if (context === 'status') {
    const mission = todayModel.mission;
    const bossDirective = todayModel.bossDirective;
    return [
      'STATUS e una sala controllo giornaliera: prima leggi se lo scan e valido, poi decidi missione, rischio boss e reward immediato.',
      latestAssessment && todayModel.scanReady
        ? `Oggi lo scan è attivo: ${latestAssessment.ansState}, HRV ${latestAssessment.hrv}ms, BOLT ${latestAssessment.bolt}s. Questo apre ${todayModel.stateTitle.toLowerCase()}.`
        : 'Se il Daily Scan manca, la schermata non sta davvero decidendo per te: il primo comando reale resta fare lo scan.',
      mission
        ? `La missione di oggi è ${mission.icon} ${mission.name}. Il motivo tattico è questo: ${todayModel.missionReason}`
        : 'Finche la missione non e validata dallo scan, non leggere Status come piano operativo completo.',
      bossDirective.boss
        ? `${bossDirective.kind === 'engage' ? 'Sul boss hai una engage window' : 'Sul boss hai un warning'}: ${bossDirective.boss.icon} ${bossDirective.boss.name}. ${bossDirective.tacticalReason}`
        : 'Finche non c e un boss utile da mostrare, Status resta centrato su scan e missione.',
      todayModel.campaign?.targetBoss
        ? `La campagna è attiva su ${todayModel.campaign.targetBoss.icon} ${todayModel.campaign.targetBoss.name}: ${todayModel.campaign.effectLines[0] || todayModel.campaign.copy}`
        : 'La campagna boss non è ancora viva: il prossimo clear aprirà la prima conseguenza persistente.',
    ].join('\n\n');
  }

  if (context === 'profile') {
    const recommendations = profileRecommendations;
    return [
      'PROFILE non serve a scegliere la prossima azione secca: serve a capire che pattern stai costruendo e quali target hanno senso per quella build.',
      `${classDef ? `${classDef.icon} ${classDef.name}` : 'Classe non assegnata'} + ${topStats || 'build in definizione'} mostrano il core della build. ${weakStat ? `La faglia attuale e ${weakStat.name} LV.${getEffectiveStatLv(weakStat.id)}.` : ''}`,
      `Punti forti: ${recommendations.strengths.text || 'non definiti'}. Debolezze: ${recommendations.weaknesses.text || 'non definite'}. Paure: ${recommendations.fears.text || 'non definite'}.`,
      `La priorita pratica emerge dai target: strength -> ${recommendations.strengths.quest ? `${recommendations.strengths.quest.icon} ${recommendations.strengths.quest.name}` : 'nessuna missione'}; weakness -> ${recommendations.weaknesses.quest ? `${recommendations.weaknesses.quest.icon} ${recommendations.weaknesses.quest.name}` : 'nessuna missione'}.`,
    ].join('\n\n');
  }

  if (context === 'codex') {
    const activeTab = activeCodexTab?.id || 'system';
    const tabLabel = activeCodexTab?.label || 'SYSTEM';
    const practicalLine = {
      system: 'Qui impari come si muove il loop generale: scan, missioni, reward, build ed endgame.',
      stats: 'Qui impari cosa misura ogni stat e quali tipi di quest la fanno salire.',
      boss: 'Qui impari quando un boss va letto come pattern e quali reward sistemiche produce.',
      loot: 'Qui impari da dove arrivano item, varianti e reward mission-based.',
      set: 'Qui impari come set, forge e upgrade boss si sommano nella build.',
      legacy: 'Qui leggi l endgame fuori dal daily loop: obiettivi lunghi e identita futura.',
    }[activeTab] || 'Qui il Codex ti spiega le regole del sistema in forma pratica.';
    return [
      `CODEX traduce regole, non priorita giornaliere. Ora sei su ${tabLabel}.`,
      practicalLine,
      'La lettura giusta e: capisco la regola qui, poi torno su Status, Quest o Armory per applicarla a una decisione reale.',
    ].join('\n\n');
  }

  if (context === 'quests') {
    const mode = getRecommendedMissionMode(latestAssessment, questFocus);
    const modeInfo = DIFFICULTY_MODES[mode] || DIFFICULTY_MODES.medium;
    return [
      `QUEST BOARD non ti chiede di leggere tutte le missioni: ti chiede di scegliere la missione giusta nella tab ${questTabDef?.label || 'attiva'}.`,
      questFocus
        ? `Focus utile ora: ${questFocus.icon} ${questFocus.name}. Mode consigliata: ${modeInfo.icon} ${modeInfo.label}.`
        : 'Se non vedi una missione chiara, usa il tab come filtro e scegli prima la missione coerente con Today Command o con il tuo punto fragile.',
      questFocus
        ? `Apri prima il protocol, poi il why. La domanda giusta qui non e “cosa c e da leggere”, ma “questa missione riduce attrito o converte progresso oggi?”.`
        : 'Il Guide qui serve a togliere overload: una missione, una mode, una checklist.',
    ].join('\n\n');
  }

  if (context === 'gear') {
    const lead = armoryLead;
    return [
      'ARMORY serve a rispondere a una domanda precisa: quale pezzo si muove davvero dopo la tua prossima azione.',
      lead
        ? `Il prossimo item rilevante e ${lead.item.icon} ${lead.item.name}. Stato: ${lead.progressState.statusLabel.toLowerCase()}. Azione richiesta: ${lead.progressState.missingLine}`
        : 'Se non vedi preview vicine, la build non ha ancora aperto abbastanza quest o requisiti per i prossimi item.',
      forgeCandidate
        ? `La forge attuale piu viva e ${forgeCandidate.item.icon} ${getItemDisplayName(forgeCandidate.item)}: ${forgeCandidate.forgeState.hint}`
        : 'Se la forge non ha priorita attive, il prossimo move reale passa da preview missione, materiali o slot vuoti.',
    ].join('\n\n');
  }

  if (context === 'boss') {
    const directive = todayModel.bossDirective;
    return [
      'BOSS CHAMBER non è una galleria nemici: è un sistema decisionale che distingue engage, avoid e prepare.',
      bossFocus
        ? `Target dominante: ${bossFocus.icon} ${bossFocus.name}. Verdetto attuale: ${directive.windowLabel}. ${directive.tacticalReason}`
        : 'Se non c e un boss centrale, la pagina va letta come preparazione, non come invito a pullare.',
      bossCampaignEffects.length
        ? `Questo fight è dentro una campagna: ${bossCampaignEffects.map(effect => formatCampaignEffectLine(effect)).slice(0, 2).join(' · ')}`
        : bossFocus
          ? 'Questo fight è ancora base state: la prossima vittoria importante deve aprire una weakness, un shortcut o una reward cache su un boss futuro.'
          : 'Senza target attivo, la campagna si legge dal prossimo ramo ancora da aprire.',
      activeBoss
        ? 'Durante il fight il Guide deve ridurre il boss a step, trigger e prova concreta di vittoria. Fuori dal fight, deve dirti se il pull ha senso oggi.'
        : 'Usa questa pagina per capire se aprire il fight adesso o se serve prima una missione di preparazione.',
    ].join('\n\n');
  }

  return [
    'Questa pagina va letta come supporto contestuale, non come archivio totale del sistema.',
    'Guarda il blocco principale, individua cosa conta ora e usa il Guide per trasformarlo in una prossima azione.',
  ].join('\n\n');
}

function explainCurrentGuidePage() {
  const model = buildGuideContextModel();
  addChatMsg(model.explainLabel || 'Explain this page', 'user');
  addChatMsg(buildGuidePageExplanation(), 'bot');
}

function renderGuideContext() {
  const panel = $('guideContextPanel');
  const promptRow = $('guidePromptRow');
  if (!panel || !promptRow) return;
  const model = buildGuideContextModel();
  panel.innerHTML = `
    <div class="guide-context-title">${model.title}</div>
    <div class="guide-context-copy">${model.copy}</div>
    <div class="guide-context-actions">
      <button class="guide-context-btn" type="button" id="guideExplainPageBtn">${model.explainLabel || 'Explain this page'}</button>
    </div>
  `;
  $('guideExplainPageBtn')?.addEventListener('click', explainCurrentGuidePage);
  promptRow.innerHTML = model.prompts.map(prompt => `<button class="guide-prompt-chip" type="button" data-guide-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join('');
  promptRow.querySelectorAll('[data-guide-prompt]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $('chatInput');
      if (!input) return;
      input.value = btn.dataset.guidePrompt;
      sendChat();
    });
  });
}

function initCompanion() {
  $('chatSend').addEventListener('click', sendChat);
  $('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });
  renderGuideContext();
  // AI config buttons
  const cfgBtn = $('btnAiConfig');
  if (cfgBtn) cfgBtn.addEventListener('click', openAiConfig);
  const saveKeyBtn = $('btnSaveAiKey');
  if (saveKeyBtn) saveKeyBtn.addEventListener('click', () => {
    const key = $('aiApiKey').value.trim();
    const model = $('aiModelSelect').value.trim();
    setAiApiKey(key);
    if (model) setAiModel(model);
    saveState();
    renderUserAvatar(currentUser?.user_metadata || {});
    aiConfigAvatarDraft = null;
    $('aiConfigModal').classList.add('hidden');
    showToast(key ? 'API Key salvata!' : 'API Key rimossa', 'success');
  });
  const cancelCfg = $('btnCancelAiConfig');
  if (cancelCfg) cancelCfg.addEventListener('click', () => {
    if (aiConfigAvatarDraft) {
      state.avatarEmoji = aiConfigAvatarDraft.emoji;
      state.avatarColor = aiConfigAvatarDraft.color;
      renderUserAvatar(currentUser?.user_metadata || {});
    }
    $('aiConfigModal').classList.add('hidden');
  });
  const openResetBtn = $('btnOpenResetAccount');
  if (openResetBtn) openResetBtn.addEventListener('click', openResetAccountModal);
  const resetInput = $('resetAccountConfirmInput');
  if (resetInput) resetInput.addEventListener('input', syncResetAccountConfirmation);
  const cancelResetBtn = $('btnCancelResetAccount');
  if (cancelResetBtn) cancelResetBtn.addEventListener('click', closeResetAccountModal);
  const confirmResetBtn = $('btnConfirmResetAccount');
  if (confirmResetBtn) confirmResetBtn.addEventListener('click', resetAccountProgress);
}

function openAiConfig() {
  $('aiApiKey').value = getAiApiKey();
  $('aiModelSelect').value = getAiModel();
  aiConfigAvatarDraft = { ...getAvatarConfig() };
  renderAvatarPicker({
    emojiContainerId: 'avatarEmojiChoices',
    colorContainerId: 'avatarColorChoices',
    previewId: 'profileAvatarPreview',
  });
  $('aiConfigModal').classList.remove('hidden');
}

function getResetConfirmationText() {
  return currentUser?.email || 'RESETTA ACCOUNT';
}

function syncResetAccountConfirmation() {
  const input = $('resetAccountConfirmInput');
  const confirmBtn = $('btnConfirmResetAccount');
  if (!input || !confirmBtn) return;
  confirmBtn.disabled = input.value.trim() !== getResetConfirmationText();
}

function openResetAccountModal() {
  $('resetAccountExpected').textContent = getResetConfirmationText();
  $('resetAccountConfirmInput').value = '';
  syncResetAccountConfirmation();
  $('resetAccountModal').classList.remove('hidden');
}

function closeResetAccountModal() {
  $('resetAccountModal').classList.add('hidden');
  $('resetAccountConfirmInput').value = '';
  syncResetAccountConfirmation();
}

async function resetAccountProgress() {
  const confirmText = getResetConfirmationText();
  if ($('resetAccountConfirmInput').value.trim() !== confirmText) return;

  clearTimeout(_saveTimeout);
  state = createFreshState();
  clearStoredState(currentUser?.id);
  writeStoredState(state, currentUser?.id);

  if (currentUser) {
    const { error } = await supabaseClient
      .from('players')
      .upsert({ id: currentUser.id, state: state });
    if (error) {
      console.warn('Supabase reset error:', error);
      showToast('Reset locale completato, ma il cloud non ha confermato il reset.', 'warning');
    }
  }

  closeResetAccountModal();
  $('aiConfigModal').classList.add('hidden');
  _initDone = false;
  init();
  $('loginScreen').classList.add('hidden');
  $('onboarding').classList.remove('hidden');
  $('mainApp').classList.add('hidden');
  goOnbStep(0);
  showToast('Account resettato. Assessment iniziale riattivato.', 'success');
}

async function sendChat() {
  const input = $('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  addChatMsg(msg, 'user');

  // Show typing indicator
  const typingId = 'typing-' + Date.now();
  const msgs = $('chatMsgs');
  const typingDiv = document.createElement('div');
  typingDiv.className = 'chat-msg bot typing';
  typingDiv.id = typingId;
  typingDiv.innerHTML = '<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';
  msgs.appendChild(typingDiv);
  msgs.scrollTop = msgs.scrollHeight;

  const reply = await companionReplyAI(msg);
  const el = document.getElementById(typingId);
  if (el) el.remove();
  addChatMsg(reply, 'bot');
}

function addChatMsg(text, who) {
  const msgs = $('chatMsgs');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + who;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ========================
// ASSESSMENT
// ========================

function initAssessment() {
  const sliders = [
    ['inHrv','vHrv'],['inBolt','vBolt'],['inMood','vMood'],['inEnergy','vEnergy'],['inSleep','vSleep']
  ];
  for (const [sid,vid] of sliders) {
    const sl = $(sid), vl = $(vid);
    if (sl && vl) sl.addEventListener('input', () => { vl.textContent = sl.value; });
  }

  const closeMetricInfoPanels = (exceptMetric = null) => {
    document.querySelectorAll('#assessForm .af-info-btn').forEach(btn => {
      const metric = btn.dataset.metricInfo;
      const panel = document.getElementById(`metricInfo${metric.charAt(0).toUpperCase()}${metric.slice(1)}`);
      const isOpen = metric === exceptMetric;
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (panel) panel.classList.toggle('hidden', !isOpen);
    });
  };

  document.querySelectorAll('#assessForm .af-info-btn').forEach(btn => {
    btn.addEventListener('click', event => {
      event.stopPropagation();
      const metric = btn.dataset.metricInfo;
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      closeMetricInfoPanels(expanded ? null : metric);
    });
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('#assessForm .af')) closeMetricInfoPanels();
  });

  $('btnAssess').addEventListener('click', () => {
    const input = {
      hrv: parseInt($('inHrv').value),
      bolt: parseInt($('inBolt').value),
      mood: parseInt($('inMood').value),
      energy: parseInt($('inEnergy').value),
      sleep: parseInt($('inSleep').value),
    };
    const ansState = determineANS(input);
    const debuffs = detectDebuffs(input, ansState);
    const assessment = { ...input, ansState, date: new Date().toISOString() };
    state.assessmentHistory.push(assessment);
    state.activeDebuffs = debuffs;
    state.lastAssessmentDate = new Date().toDateString();

    // Streak
    const yesterday = new Date(Date.now()-86400000).toDateString();
    const prev = state.assessmentHistory.length > 1
      ? new Date(state.assessmentHistory[state.assessmentHistory.length-2].date).toDateString()
      : null;
    if (prev === yesterday) state.currentStreak++;
    else if (prev !== new Date().toDateString()) state.currentStreak = 1;

    state.todayCompleted = [];
    state.todayCompletedDetails = [];
    state.todayCombos = [];
    saveState();

    renderAssessResult(input, ansState, debuffs);
    triggerGlitch();
    showToast('Biomarcatori analizzati','success');
    showSystemPopup({
      tone: isForcedRest() ? 'warning' : 'info',
      badge: isForcedRest() ? 'WARNING' : 'GUIDE',
      title: isForcedRest() ? 'FORCED REST DAY' : 'SCAN COMPLETATO',
      body: isForcedRest()
        ? 'Biomarcatori in zona rossa. Il sistema impone recovery, downshift vagale e niente raid ad alto stress.'
        : `Stato ${ansState}. Quest Board, advice engine e danger rating sono stati ricalibrati.`,
      urgent: isForcedRest(),
      sound: isForcedRest() ? 'urgent' : 'soft',
    });
  });

  $('btnReassess').addEventListener('click', () => {
    $('assessResult').classList.add('hidden');
    $('assessForm').style.display = 'block';
    closeMetricInfoPanels();
  });
}

function renderAssessResult(input, ans, debuffs) {
  $('assessForm').style.display = 'none';
  $('assessResult').classList.remove('hidden');
  const summary = buildAssessmentSummary(input, ans, debuffs);

  const badge = $('ansBadge');
  badge.textContent = ans.replace(/_/g,' ');
  badge.className = 'ans-badge';
  if (ans==='SYMPATHETIC') badge.classList.add('symp');
  else if (ans==='PARASYMPATHETIC') badge.classList.add('para');

  const summaryCard = $('assessSummaryCard');
  summaryCard.innerHTML = `
    <div class="assess-summary-head">
      <div>
        <div class="assess-summary-kicker">TODAY'S RECOMMENDATION</div>
        <h2 class="assess-summary-title">${escapeHtml(summary.systemState)}</h2>
      </div>
      <div class="assess-summary-intensity" style="border-color:${summary.intensityInfo.color};color:${summary.intensityInfo.color}">${summary.intensityInfo.icon} ${summary.intensityInfo.label}</div>
    </div>
    <div class="assess-summary-grid">
      <div class="assess-summary-item">
        <span>Today's system state</span>
        <strong>${escapeHtml(summary.systemState)}</strong>
        <small>${escapeHtml(interpretANS(ans))}</small>
      </div>
      <div class="assess-summary-item">
        <span>Recommended mission type</span>
        <strong>${escapeHtml(summary.missionType)}</strong>
        <small>${summary.mission ? `${summary.mission.icon} ${escapeHtml(summary.mission.name)}` : 'Recovery first'}</small>
      </div>
      <div class="assess-summary-item">
        <span>Recommended intensity</span>
        <strong>${escapeHtml(summary.intensityInfo.label)}</strong>
        <small>${summary.lowRecovery ? 'Carico abbassato per proteggere il recupero.' : 'Intensità dosata sullo stato del giorno.'}</small>
      </div>
      <div class="assess-summary-item">
        <span>Recommendation logic</span>
        <strong>${summary.primarySignal === 'strengths' ? 'Build strengths' : summary.primarySignal === 'fears' ? 'Friction reduction' : 'Recovery protection'}</strong>
        <small>${escapeHtml(summary.explanation || 'La raccomandazione usa i segnali più rilevanti del tuo scan.')}</small>
      </div>
    </div>
    <div class="assess-boss-brief ${summary.bossDirective.kind === 'engage' ? 'engage' : 'avoid'}">
      <div class="assess-boss-brief-head">
        <div>
          <div class="assess-summary-kicker">BOSS DIRECTIVE</div>
          <div class="assess-boss-brief-title">${escapeHtml(summary.bossDirective.kind === 'engage' ? 'Boss to confront today' : 'Boss to avoid today')}</div>
        </div>
        <div class="assess-boss-pill">${summary.bossDirective.kind === 'engage' ? 'CONFRONT' : 'AVOID'}</div>
      </div>
      <div class="assess-boss-target">
        <strong>${summary.bossDirective.boss ? `${summary.bossDirective.boss.icon} ${escapeHtml(summary.bossDirective.boss.name)}` : 'No boss target'}</strong>
        <small>${escapeHtml(summary.bossDirective.summary)}</small>
      </div>
      <ul class="assess-summary-list assess-boss-list">${summary.bossWhy.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>
    ${summary.lowRecovery ? `<div class="assess-summary-risk">⚠ ${escapeHtml(summary.riskWarning)}</div>` : ''}
    <div class="assess-summary-why">
      <div class="assess-summary-why-label">Why this was chosen</div>
      <ul class="assess-summary-list">${summary.why.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>
    ${summary.outcome ? `
      <div class="assess-summary-footer">
        <span>Expected reward</span>
        <strong>+${summary.outcome.totalXP} XP</strong>
        <small>${escapeHtml(summary.outcome.itemProgress)}</small>
      </div>
    ` : ''}
  `;

  // Metrics
  const met = $('assessMetrics');
  met.innerHTML = `
    <div class="am-card"><div class="am-label">HRV</div><div class="am-value">${input.hrv}ms</div><div class="am-copy">${escapeHtml(interpretHRV(input.hrv))}</div></div>
    <div class="am-card"><div class="am-label">BOLT</div><div class="am-value">${input.bolt}s</div><div class="am-copy">${escapeHtml(interpretBOLT(input.bolt))}</div></div>
    <div class="am-card"><div class="am-label">MOOD</div><div class="am-value">${input.mood}/10</div><div class="am-copy">${input.mood <= 4 ? 'Attrito emotivo alto.' : input.mood >= 7 ? 'Stato emotivo favorevole.' : 'Stato emotivo stabile.'}</div></div>
    <div class="am-card"><div class="am-label">ENERGY</div><div class="am-value">${input.energy}/10</div><div class="am-copy">${input.energy <= 4 ? 'Spinta bassa: meglio task chiudibili.' : input.energy >= 7 ? 'Buona capacità di output.' : 'Energia gestibile senza forzare.'}</div></div>
    <div class="am-card"><div class="am-label">SLEEP</div><div class="am-value">${input.sleep}/10</div><div class="am-copy">${input.sleep <= 4 ? 'Recupero ridotto.' : input.sleep >= 7 ? 'Recupero solido.' : 'Recupero discreto ma non pieno.'}</div></div>
    <div class="am-card"><div class="am-label">STREAK</div><div class="am-value">${state.currentStreak}d</div></div>`;

  // Rest
  const ra = $('restAlert');
  if (isForcedRest()) ra.classList.remove('hidden'); else ra.classList.add('hidden');

  // Debuffs
  const de = $('assessDebuffs');
  if (debuffs.length > 0) {
    de.innerHTML = debuffs.map(d => `<div class="debuff-card active-d">${d.icon} ${d.name}</div>`).join('');
  } else {
    de.innerHTML = '<div class="debuff-card ok">◈ NESSUN DEBUFF</div>';
  }
}

// ========================
// LEVEL UP OVERLAY
// ========================

function showLevelUpOverlay() {
  const o = $('levelUpOverlay');
  $('lvlDetail').innerHTML = `${getTitle()}<br>Hunter Rank: ${getTotalLevel()}`;
  o.classList.remove('hidden');
}

$('btnDismissLvl').addEventListener('click', () => {
  $('levelUpOverlay').classList.add('hidden');
});

// ========================
// INIT
// ========================

function init() {
  try {
  // Migrate state
  if (!state.weeklyCompleted)  state.weeklyCompleted = [];
  if (!state.chainProgress)    state.chainProgress = {};
  if (!state.todayCombos)      state.todayCombos = [];
  if (state.totalCombos == null) state.totalCombos = 0;
  if (!state.achievements)     state.achievements = [];
  if (!state.inventory)        state.inventory = [];
  if (!state.factionRep)       state.factionRep = { PHYSIQUE:0, COGNITIVE:0, NEURAL:0, SOCIAL:0 };
  if (state.criticalHits == null) state.criticalHits = 0;
  if (!state.todayCompletedDetails) state.todayCompletedDetails = [];
  if (!state.customQuests)     state.customQuests = [];
  if (state.onboardingRank == null) state.onboardingRank = 1;
  if (!state.ownedEquipment)   state.ownedEquipment = [];
  if (!state.equippedGear)     state.equippedGear = createEmptyGearSlots();
  state.ownedEquipment = [...new Set((state.ownedEquipment || []).map(itemId => LEGACY_EQUIPMENT_ID_MAP[itemId] || itemId))].filter(itemId => !!EQUIPMENT_CATALOG[itemId]);
  state.specialQuestCompleted = [...new Set((state.specialQuestCompleted || []).map(questId => LEGACY_SPECIAL_QUEST_MAP[questId] || questId))];
  state.equippedGear = Object.entries(state.equippedGear || {}).reduce((acc, [slot, itemId]) => {
    const mappedSlot = LEGACY_SLOT_MAP[slot] || slot;
    const mappedItem = LEGACY_EQUIPMENT_ID_MAP[itemId] || itemId;
    if (createEmptyGearSlots()[mappedSlot] !== undefined && mappedItem && EQUIPMENT_CATALOG[mappedItem]) {
      acc[mappedSlot] = mappedItem;
    }
    return acc;
  }, createEmptyGearSlots());
  state.equippedGear = { ...createEmptyGearSlots(), ...state.equippedGear };
  if (!state.specialQuestCompleted) state.specialQuestCompleted = [];
  if (!state.setUpgrades) state.setUpgrades = {};
  if (!state.flaskCooldowns) state.flaskCooldowns = {};
  if (!state.materials) state.materials = {};
  if (!state.equipmentUpgrades) state.equipmentUpgrades = {};
  if (!state.codexTab) state.codexTab = 'rank';
  if (!state.bucketListChecks) state.bucketListChecks = {};
  if (!state.bossTitles) state.bossTitles = [];
  if (!state.avatarEmoji) state.avatarEmoji = AVATAR_EMOJI_OPTIONS[0];
  if (!state.avatarColor) state.avatarColor = AVATAR_COLOR_OPTIONS[0];
  if (!state.startHere || typeof state.startHere !== 'object') {
    state.startHere = { startedAt: null, basicsReviewed: false, adaptiveReviewed: false, weeklyRecapReviewed: false, buildPath: null };
  }
  state.startHere = {
    startedAt: state.startHere.startedAt || null,
    basicsReviewed: !!state.startHere.basicsReviewed,
    adaptiveReviewed: !!state.startHere.adaptiveReviewed,
    weeklyRecapReviewed: !!state.startHere.weeklyRecapReviewed,
    buildPath: state.startHere.buildPath || null,
  };
  if (state.onboardingDone && !state.startHere.startedAt) state.startHere.startedAt = new Date().toISOString();

  initStats();
  resetWeeklyIfNeeded();
  cleanExpiredBuffs();
  renderUserAvatar(currentUser?.user_metadata || {});
  initOnboarding();
  initCompanion();
  initCustomQuestModal();
  initAssessment();
  initTimedQuestOverlay();
  if (state.onboardingDone) {
    renderStatus();
    renderCodex();
    renderGear();
    checkAchievements();
  }
  } catch (e) {
    console.error('Init error:', e);
    // Assicurati che l'app sia visibile anche se c'è un errore parziale
    if (state.onboardingDone) {
      $('onboarding').classList.add('hidden');
      $('mainApp').classList.remove('hidden');
    } else {
      $('onboarding').classList.remove('hidden');
      $('mainApp').classList.add('hidden');
    }
  }
}

function initTimedQuestOverlay() {
  const startBtn = $('btnTqStart');
  const stopBtn = $('btnTqStop');
  const cancelBtn = $('btnTqCancel');
  if (startBtn) startBtn.addEventListener('click', startTimedQuest);
  if (stopBtn) stopBtn.addEventListener('click', stopTimedQuest);
  if (cancelBtn) cancelBtn.addEventListener('click', cancelTimedQuest);
}

// init() is called by auth.onAuthStateChanged, not directly
