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
let _systemPopupInterval = null;
let _lastSystemPopupAt = 0;
let _systemAudioContext = null;
let _systemAudioUnlocked = false;
let _gearCooldownInterval = null;
const _domReadyPromise = document.readyState === 'loading'
  ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  : Promise.resolve();

function $(id) { return document.getElementById(id); }

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

function getBestLocalState(uid) {
  return readStoredState(uid) || readStoredState() || { ...DEFAULT_STATE };
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
      const merged = { ...DEFAULT_STATE, ...data.state };
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
  $('userAvatar').src = meta.avatar_url || meta.picture || '';
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
];

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
};

const BOSS_SET_UPGRADES = {
  ANXIETY_WRAITH: { setId:'MONARCH_SYNTH', bonuses:{ VAG:1 } },
  LETHARGY_GOLEM: { setId:'IRON_HEART', bonuses:{ RES:1 } },
  PROCRASTINATION_LEECH: { setId:'SHADOWFORGED', bonuses:{ DIS:1 } },
  ANGER_BERSERKER: { setId:'IRON_HEART', bonuses:{ STR:1 } },
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

function getTitle() {
  const lv = getTotalLevel();
  let title = 'Neophyte';
  for (const t of TITLES) { if (lv >= t.lv) title = t.t; }
  return title;
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

  return `Sei lo SHADOW GUIDE, un consulente neuro-tattico dentro un'app di gamification chiamata NEURO-LEVELING (ispirata a Solo Leveling).
Rispondi SEMPRE in italiano. Sii conciso, diretto, nerd e in tema col gioco. Usa il tono di un mentore da videogame dark-fantasy che pero sa davvero leggere biomarcatori, stress e performance.
Non usare emoji in eccesso. Max 2-3 frasi per risposta tranne se l'utente chiede spiegazioni dettagliate.
Mescola linguaggio scientifico e linguaggio da sistema di progressione: quest, build, raid, debuff, cooldown, scan, loadout, dungeon, boss.
Evita frasi corporate o troppo adulte: la sensazione deve essere da sistema urgente, misterioso e coinvolgente, non da coach generico.

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

  // Start
  $('onbStart').addEventListener('click', () => {
    const name = $('onbName').value.trim();
    if (!name) { $('onbName').focus(); return; }
    state.playerName = name;
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

  goOnbStep(7);
}

// ========================
// NAVIGATION
// ========================

function switchScreen(name) {
  currentScreen = name;
  $$('.screen').forEach(s => s.classList.remove('active'));
  const el = $('screen' + name.charAt(0).toUpperCase() + name.slice(1));
  if (el) el.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  triggerGlitch();

  if (name==='status') renderStatus();
  else if (name==='codex') renderCodex();
  else if (name==='quests') renderQuests();
  else if (name==='boss') renderBossGrid();
  else if (name==='gear') renderGear();

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

  const guide = $('systemGuideCard');
  if (guide) {
    guide.innerHTML = `
      <div class="system-guide-title">COME LEGGERE IL SISTEMA</div>
      <div class="system-guide-copy">Hunter Rank è il tuo livello vero e sale con quest e boss. Class Sync misura quanto la tua build è allineata alla classe scelta. Le stat mostrano la forza dei singoli attributi, con bonus da gear e set già inclusi.</div>
      <div class="system-guide-mini">
        <div class="system-guide-pill">Hunter Rank ${rankInfo.rank} · progressione account</div>
        <div class="system-guide-pill">Class Sync ${getClassLevel()} · potenza specializzazione</div>
      </div>`;
  }

  // Primary stats
  const priEl = $('statsPrimary');
  priEl.innerHTML = PRIMARY_STATS.map(s => {
    const lv = getStatLv(s.id);
    const bonus = getEquipmentBonusForStat(s.id);
    const shownLv = lv + bonus;
    const xpN = xpForLevel(lv+1);
    const xpC = state.stats[s.id]?.xp ?? 0;
    const pct = Math.min((xpC/Math.max(xpN,1))*100, 100);
    return `<div class="stat-row">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-info">
        <div class="stat-name"><span class="stat-name-txt">${s.name}</span><span class="stat-lv" style="color:${s.color}">LV.${shownLv}${bonus ? ` (+${bonus})` : ''}</span></div>
        <div class="stat-bar-wrap"><div class="stat-bar-fill" style="width:${pct}%;background:${s.color}"></div></div>
      </div>
    </div>`;
  }).join('');

  // Secondary stats
  const secEl = $('statsSecondary');
  secEl.innerHTML = SECONDARY_STATS.map(s => {
    const lv = getStatLv(s.id);
    const bonus = getEquipmentBonusForStat(s.id);
    const shownLv = lv + bonus;
    const xpN = xpForLevel(lv+1);
    const xpC = state.stats[s.id]?.xp ?? 0;
    const pct = Math.min((xpC/Math.max(xpN,1))*100, 100);
    return `<div class="stat-row">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-info">
        <div class="stat-name"><span class="stat-name-txt">${s.name}</span><span class="stat-lv" style="color:${s.color}">LV.${shownLv}${bonus ? ` (+${bonus})` : ''}</span></div>
        <div class="stat-bar-wrap"><div class="stat-bar-fill" style="width:${pct}%;background:${s.color}"></div></div>
      </div>
    </div>`;
  }).join('');

  // Debuffs
  const debEl = $('debuffsList');
  if (state.activeDebuffs.length === 0) {
    debEl.innerHTML = '<div class="debuff-card ok">◈ SISTEMA STABILE</div>';
  } else {
    debEl.innerHTML = state.activeDebuffs.map(d =>
      `<div class="debuff-card active-d">${d.icon} ${d.name}</div>`
    ).join('');
  }

  // Mini grid
  $('streakV').textContent = state.currentStreak;
  $('totalXpV').textContent = state.totalXP;
  $('questsDoneV').textContent = state.questsCompleted;
  $('bossKillsV').textContent = state.bossesDefeated.length;

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

  // Faction Reputation
  const facEl = $('statusFactions');
  if (facEl) {
    facEl.innerHTML = FACTION_DEFINITIONS.map(f => {
      const rep = state.factionRep?.[f.id] ?? 0;
      const rank = getFactionRank(f.id);
      const nextRank = FACTION_RANKS.find(r => r.rep > rep);
      const pct = nextRank ? Math.min((rep / nextRank.rep) * 100, 100) : 100;
      return `<div class="faction-row">
        <div class="faction-head"><span>${f.icon} ${f.name}</span><span class="faction-rank" style="color:${f.color}">${rank.name}</span></div>
        <div class="faction-bar-wrap"><div class="faction-bar-fill" style="width:${pct}%;background:${f.color}"></div></div>
        <div class="faction-rep">${rep} REP ${nextRank ? `/ ${nextRank.rep}` : '(MAX)'} — x${rank.mult} XP</div>
      </div>`;
    }).join('');
  }

  // Achievements
  const achEl = $('statusAchievements');
  if (achEl) {
    const unlocked = state.achievements || [];
    achEl.innerHTML = ACHIEVEMENT_DEFINITIONS.map(a => {
      const done = unlocked.includes(a.id);
      return `<div class="ach-badge ${done?'ach-done':'ach-locked'}" title="${a.desc}">${a.icon}<span class="ach-name">${a.name}</span></div>`;
    }).join('');
  }
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
    const totalRew = q.rewards.reduce((a,r) => a + r.xp, 0);
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

    // XP preview for each mode (matches completeQuest formula)
    const xpPreview = !done && !locked ? `<div class="diff-mode-selector" data-qid="${q.id}">
      ${Object.entries(DIFFICULTY_MODES).map(([k,m]) => {
        const diffEff = Math.max(1, q.diff + m.diffOffset);
        const mRarity = getQuestRarity(diffEff);
        const mRarityMult = RARITY_MULT[mRarity];
        let mXP = 0;
        for (const rew of q.rewards) {
          const pen = getDebuffPenalty(rew.stat);
          let eff = calcXP(rew.xp, diffEff, state.currentStreak, pen);
          eff = Math.round(eff * mRarityMult * m.xpMult);
          mXP += eff;
        }
        return `<button class="diff-mode-btn" data-mode="${k}" data-qid="${q.id}" style="border-color:${m.color}"><span class="dm-icon">${m.icon}</span><span class="dm-label">${m.label}</span><span class="dm-xp">+${mXP}</span></button>`;
      }).join('')}
    </div>` : '';

    return `
      <div class="quest-card ${cls} rarity-border-${rarity.toLowerCase()}" data-quest-id="${q.id}" data-cat="${q.cat}">
        <div class="q-check">${done ? '✓' : (locked ? '🔒' : '')}</div>
        <span class="q-icon">${q.icon}</span>
        <div class="q-body">
          <div class="q-name">${q.name} ${bonusTag} ${gearTag} ${timedTag} ${doneModeBadge}</div>
          <div class="q-tags">${rarityTag}<span class="q-cat-tag">${q.cat}</span></div>
          <div class="q-desc">${q.desc}</div>
          <div class="q-meta"><span class="q-dur">${q.dur} min</span><span class="q-xp">+${(() => { const de = Math.max(1, q.diff); const rr = RARITY_MULT[getQuestRarity(de)]; let t = 0; for (const r of q.rewards) { t += Math.round(calcXP(r.xp, de, state.currentStreak, getDebuffPenalty(r.stat)) * rr); } return t; })()} XP</span></div>
          ${lootPreview}
          ${xpPreview}
          <div class="q-detail" id="detail-${q.id}">
            <ol>${q.protocol.map(p=>`<li>${p}</li>`).join('')}</ol>
            <div class="q-sci">${q.science}</div>
          </div>
        </div>
        <div class="q-rank rk-${rank}">${rank}</div>
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

  // Card click: toggle detail (not start quest — use buttons)
  listEl.querySelectorAll('.quest-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.diff-mode-btn')) return;
      const qid = card.dataset.questId;
      const p = $('detail-'+qid);
      if (p) p.classList.toggle('open');
    });
  });
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
      return `
        <div class="quest-card done rarity-border-${getQuestRarity(q.diff).toLowerCase()}" data-quest-id="${q.id}" data-cat="${q.cat}">
          <div class="q-check">✓</div>
          <span class="q-icon">${q.icon}</span>
          <div class="q-body">
            <div class="q-name">${q.name} ${gearTag} <span class="done-mode-badge" style="color:${modeInfo.color}">${modeInfo.icon} ${modeInfo.label}</span></div>
            <div class="q-tags"><span class="q-cat-tag">${q.cat}</span><span class="timed-tag">COMPLETATA</span></div>
            <div class="q-desc">${q.desc}</div>
            <div class="q-meta"><span class="q-dur">${q.dur} min${timeLbl}</span><span class="q-xp">+${earnedXp} XP</span></div>
            <div class="q-detail" id="detail-completed-${entry.index}">
              <ol>${q.protocol.map(p=>`<li>${p}</li>`).join('')}</ol>
              <div class="q-sci">${q.science}</div>
            </div>
          </div>
          <div class="q-rank rk-${getRank(q.diff)}">✓</div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.quest-card').forEach(card => {
      card.addEventListener('click', () => {
        const detail = card.querySelector('.q-detail');
        if (detail) detail.classList.toggle('open');
      });
    });
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
    const subProgress = q.subQuests.length > 0
      ? q.subQuests.map(sq => state.todayCompleted.includes(sq) ? '✅' : '⬜').join(' ')
      : '';

    return `
      <div class="quest-card ${cls} rarity-border-legendary weekly-card" data-quest-id="${q.id}" data-cat="${q.cat}">
        <div class="q-check">${done ? '✓' : (locked ? '🔒' : (canComplete ? '⚡' : ''))}</div>
        <span class="q-icon">${q.icon}</span>
        <div class="q-body">
          <div class="q-name">${q.name} <span class="weekly-tag">WEEKLY</span></div>
          <div class="q-desc">${q.desc}</div>
          ${subProgress ? `<div class="q-sub-progress">${subProgress}</div>` : ''}
          <div class="q-meta"><span class="q-dur">${q.dur} min</span><span class="q-xp">+${totalRew} XP</span></div>
          <div class="q-detail" id="detail-${q.id}">
            <ol>${q.protocol.map(p=>`<li>${p}</li>`).join('')}</ol>
            <div class="q-sci">${q.science}</div>
          </div>
        </div>
        <div class="q-rank rk-S">W</div>
      </div>`;
  }).join('');

  const total = WEEKLY_QUESTS.length;
  const done = (state.weeklyCompleted||[]).filter(id => WEEKLY_QUESTS.some(q=>q.id===id)).length;
  const pct = total > 0 ? Math.round((done/total)*100) : 0;
  $('qpFill').style.width = pct+'%';
  $('qpText').textContent = `${done} / ${total} weekly`;
  $('totalRewXp').textContent = '';

  listEl.querySelectorAll('.quest-card').forEach(card => {
    card.addEventListener('click', () => handleQuestClick(card.dataset.questId, 'weekly'));
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
      const p = $('detail-'+qid); if (p) p.classList.toggle('open'); return;
    }
    if (!meetsReq(wq.req)) { showToast('Requisiti non soddisfatti','alert'); return; }
    if (!checkWeeklyCompletion(wq)) {
      const p = $('detail-'+qid);
      if (p && !p.classList.contains('open')) { p.classList.add('open'); return; }
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
  return Object.keys(STAT_META).reduce((sum, statId) => sum + getEquipmentBonusForStat(statId), 0);
}

function getGearRarityClass(rarity) {
  return `gear-rarity-${String(rarity || '').toLowerCase()}`;
}

const CODEX_TAB_DEFS = [
  { id:'rank', label:'RANK' },
  { id:'stats', label:'STATS' },
  { id:'boss', label:'BOSS' },
  { id:'drop', label:'DROP RATE' },
  { id:'set', label:'SET BONUS' },
];

function renderCodex() {
  const tabsEl = $('codexTabs');
  const contentEl = $('codexContent');
  if (!tabsEl || !contentEl) return;

  const activeTab = state.codexTab || 'rank';
  const rankInfo = getHunterRankInfo();
  const playerClass = CLASS_DEFINITIONS.find(c => c.id === state.playerClass);
  const allStats = [...PRIMARY_STATS, ...SECONDARY_STATS];
  const effectiveStats = allStats
    .map(stat => ({
      ...stat,
      base: getStatLv(stat.id),
      bonus: getEquipmentBonusForStat(stat.id),
      total: getEffectiveStatLv(stat.id),
    }))
    .sort((a, b) => b.total - a.total);
  const setCounts = getEquippedSetCounts();
  const guideCards = `
    <div class="codex-card">
      <div class="codex-card-title">COME LEGGERE NEURO-LEVELING</div>
      <div class="codex-card-copy"><strong>Hunter Rank</strong> è il livello vero dell'account. <strong>Class Sync</strong> misura quanto la tua build segue la classe. Le <strong>quest</strong> alzano stat e rank. <strong>Boss</strong>, <strong>gear</strong>, <strong>set</strong> e <strong>forge</strong> moltiplicano la build.</div>
      <div class="codex-chip-list">
        <span class="codex-chip">1. Scan con Assessment</span>
        <span class="codex-chip">2. Scegli la difficoltà</span>
        <span class="codex-chip">3. Completa checklist missione</span>
        <span class="codex-chip">4. Raccogli XP, materiali e drop</span>
      </div>
    </div>
    <div class="codex-card">
      <div class="codex-card-title">GEAR FLOW</div>
      <div class="codex-card-copy">Le Special Quest sbloccano pezzi o varianti dello stesso slot. I materiali servono per la forge +1/+2/+3. I boss rilasciano drop unici e upgrade permanenti ai set.</div>
    </div>`;

  const codexPages = {
    rank: `
      ${guideCards}
      <div class="codex-card">
        <div class="codex-card-title">RANK PROTOCOL</div>
        <div class="codex-card-copy">Hunter Rank è il livello globale del profilo. Parte dall'assessment iniziale e poi sale solo con quest, boss, gear e drop. Class Sync misura invece quanto la tua classe è allineata alla build attuale.</div>
        <div class="codex-chip-list">
          <span class="codex-chip">Hunter Rank ${rankInfo.rank}</span>
          <span class="codex-chip">Class Sync ${getClassLevel()}</span>
          <span class="codex-chip">Titolo ${getTitle()}</span>
          <span class="codex-chip">Streak ${state.currentStreak}</span>
        </div>
      </div>
      <div class="codex-card">
        <div class="codex-card-title">BUILD STATUS</div>
        <div class="codex-list">
          <div class="codex-row">
            <div>
              <div class="codex-row-title">Classe attuale</div>
              <div class="codex-row-copy">${playerClass ? `${playerClass.icon} ${playerClass.name} · ${playerClass.desc}` : 'Classe non assegnata.'}</div>
            </div>
            <div class="codex-chip">Sync ${getClassLevel()}</div>
          </div>
          <div class="codex-row">
            <div>
              <div class="codex-row-title">Progressione del rank</div>
              <div class="codex-row-copy">${rankInfo.nextXp > 0 ? `${rankInfo.xpIntoRank} / ${rankInfo.nextXp} XP nel rank corrente.` : 'Rank massimo raggiunto.'}</div>
            </div>
            <div class="codex-chip">XP ${state.totalXP}</div>
          </div>
          <div class="codex-row">
            <div>
              <div class="codex-row-title">Gear power</div>
              <div class="codex-row-copy">Include bonus item, set attivi e upgrade permanenti ottenuti dai boss.</div>
            </div>
            <div class="codex-chip">+${getTotalGearPower()}</div>
          </div>
        </div>
      </div>`,
    stats: `
      <div class="codex-card">
        <div class="codex-card-title">STAT MATRIX</div>
        <div class="codex-card-copy">Valori effettivi già comprensivi di equipaggiamento, set bonus e forge levels.</div>
        <div class="codex-list">
          ${effectiveStats.map(stat => `
            <div class="codex-row">
              <div>
                <div class="codex-row-title">${stat.icon} ${stat.name}</div>
                <div class="codex-row-copy">Base ${stat.base}${stat.bonus ? ` · bonus gear/set +${stat.bonus}` : ''}</div>
              </div>
              <div class="codex-chip">LV ${stat.total}</div>
            </div>`).join('')}
        </div>
      </div>`,
    boss: `
      <div class="codex-card">
        <div class="codex-card-title">BOSS INDEX</div>
        <div class="codex-list">
          ${BOSS_DEFINITIONS.map(boss => {
            const bossDrop = (BOSS_DROP_TABLES[boss.id] || [])[0];
            const dropItem = bossDrop ? EQUIPMENT_CATALOG[bossDrop.itemId] : null;
            const upgrade = BOSS_SET_UPGRADES[boss.id];
            const defeated = (state.bossesDefeated || []).includes(boss.id);
            return `
              <div class="codex-row">
                <div>
                  <div class="codex-row-title">${boss.icon} ${boss.name}</div>
                  <div class="codex-row-copy">LV ${boss.level} · ${defeated ? 'boss sconfitto' : `req ${boss.req.map(req => `${req.stat} ${req.minLv}`).join(' · ')}`}</div>
                  <div class="codex-chip-list">
                    ${dropItem ? `<span class="codex-chip">DROP ${dropItem.icon} ${getItemDisplayName(dropItem)}</span>` : ''}
                    ${upgrade ? `<span class="codex-chip">SET ${EQUIPMENT_SET_BONUSES[upgrade.setId]?.name || upgrade.setId} · ${Object.entries(upgrade.bonuses).map(([stat, amount]) => `+${amount} ${stat}`).join(' · ')}</span>` : ''}
                  </div>
                </div>
                <div class="codex-chip">${defeated ? 'CLEAR' : 'LOCK/READY'}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`,
    drop: `
      <div class="codex-card">
        <div class="codex-card-title">SPECIAL QUEST LOOT TABLE</div>
        <div class="codex-list">
          ${SPECIAL_QUESTS.map(quest => `
            <div class="codex-row">
              <div>
                <div class="codex-row-title">${quest.icon} ${quest.name}</div>
                <div class="codex-row-copy">${quest.desc}</div>
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
        <div class="codex-card-title">SET BONUS MATRIX</div>
        <div class="codex-list">
          ${Object.entries(EQUIPMENT_SET_BONUSES).map(([setId, setDef]) => {
            const upgrades = state.setUpgrades?.[setId] || {};
            const material = MATERIAL_CATALOG[SET_PRIMARY_MATERIAL[setId]];
            return `
              <div class="codex-row">
                <div>
                  <div class="codex-row-title">${setDef.icon} ${setDef.name}</div>
                  <div class="codex-row-copy">${Object.entries(setDef.thresholds).map(([threshold, stats]) => `${threshold}p: ${Object.entries(stats).map(([stat, amount]) => `+${amount} ${stat}`).join(' · ')}`).join(' | ')}</div>
                  <div class="codex-chip-list">
                    <span class="codex-chip">Equip ${setCounts[setId] || 0}/4</span>
                    <span class="codex-chip">Forge ${material?.icon || '✦'} ${material?.name || 'Materiale'}</span>
                    ${Object.keys(upgrades).length ? `<span class="codex-chip">Boss upgrade ${Object.entries(upgrades).map(([stat, amount]) => `+${amount} ${stat}`).join(' · ')}</span>` : ''}
                  </div>
                </div>
                <div class="codex-chip">${(setCounts[setId] || 0) >= 4 ? 'FULL SET' : 'PARTIAL'}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`,
  };

  tabsEl.innerHTML = CODEX_TAB_DEFS.map(tab => `<button class="codex-tab ${tab.id === activeTab ? 'active' : ''}" data-codex-tab="${tab.id}">${tab.label}</button>`).join('');
  contentEl.innerHTML = codexPages[activeTab] || codexPages.rank;

  tabsEl.querySelectorAll('[data-codex-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.codexTab = btn.dataset.codexTab;
      saveState();
      renderCodex();
    });
  });
}

function renderGear() {
  const powerEl = $('gearPowerValue');
  const descEl = $('gearPowerDesc');
  const blueprintEl = $('gearBlueprintList');
  const setListEl = $('gearSetList');
  const materialsEl = $('gearMaterialsList');
  const slotsEl = $('gearSlotsGrid');
  const inventoryEl = $('gearInventoryList');
  const consumablesEl = $('gearConsumablesList');
  if (!powerEl || !descEl || !blueprintEl || !setListEl || !materialsEl || !slotsEl || !inventoryEl || !consumablesEl) return;

  const totalPower = getTotalGearPower();
  const equippedCount = Object.values(state.equippedGear || {}).filter(Boolean).length;
  powerEl.textContent = `+${totalPower}`;
  descEl.textContent = totalPower
    ? `${equippedCount}/${EQUIPMENT_SLOTS.length} slot attivi. Bonus item e set gia applicati ai requisiti e ai livelli mostrati.`
    : 'Completa le quest speciali per riempire il loadout e sbloccare bonus progressivi di set.';

  blueprintEl.innerHTML = EQUIPMENT_SLOTS.map(slot => {
    const equippedItem = getEquippedItem(slot);
    const sourceQuests = getSlotBlueprintQuests(slot);
    const sourceText = sourceQuests.length
      ? sourceQuests.map(quest => `${quest.icon} ${quest.name}`).join(' · ')
      : 'Slot alimentato da boss drop o varianti avanzate.';
    return `
      <div class="gear-blueprint-card ${equippedItem ? 'active' : ''}">
        <div class="gear-blueprint-slot">${EQUIPMENT_SLOT_LABELS[slot]}</div>
        <div class="gear-blueprint-state">${equippedItem ? `${equippedItem.icon} ${getItemDisplayName(equippedItem)}` : 'Slot vuoto'}</div>
        <div class="gear-blueprint-source">${sourceText}</div>
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
            <div class="gear-slot-empty">Slot vuoto. ${getSlotBlueprintQuests(slot).length ? `Farmalo con ${getSlotBlueprintQuests(slot).map(quest => quest.name).join(' / ')}.` : 'Continua con special quest e boss avanzati per sbloccarlo.'}</div>`}
      </div>`;
  }).join('');

  const owned = getOwnedEquipmentItems();
  const arsenalItems = owned.filter(item => !isFlaskItem(item.id));
  inventoryEl.innerHTML = arsenalItems.length ? arsenalItems.map(item => {
    const equipped = state.equippedGear?.[item.slot] === item.id;
    const bonuses = Object.entries(getItemBonuses(item)).map(([stat,val]) => `<span class="gear-bonus-pill">+${val} ${stat}</span>`).join('');
    const upgrade = getUpgradeCost(item);
    const canUpgrade = upgrade && hasUpgradeMaterials(upgrade.costs);
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
            <div class="gear-upgrade-cost">${upgrade ? formatMaterialCost(upgrade.costs) : 'Potenziamento massimo raggiunto'}</div>
          </div>
          <button class="btn ${canUpgrade ? '' : 'ghost'}" data-upgrade-item="${item.id}" ${upgrade ? '' : 'disabled'}>${upgrade ? 'Forge' : 'MAX'}</button>
        </div>
        <div class="gear-card-actions">
          <button class="btn ${equipped ? 'ghost' : ''}" data-equip-item="${item.id}">${equipped ? 'Equipaggiato' : 'Equipaggia'}</button>
        </div>
      </div>`;
  }).join('') : '<div class="gear-empty-state">Nessun equip ottenuto. Le missioni speciali iniziano a comparire quando alzi le stat richieste.</div>';

  const flaskItems = owned.filter(item => isFlaskItem(item.id));
  consumablesEl.innerHTML = flaskItems.length ? flaskItems.map(item => {
    const effect = FLASK_EFFECTS[item.id];
    const cooldownRemaining = getFlaskCooldownRemaining(item.id);
    const cooldownPct = effect.cooldownMs > 0 ? Math.max(0, Math.min(100, 100 - (cooldownRemaining / effect.cooldownMs) * 100)) : 100;
    const ready = cooldownRemaining <= 0;
    const upgrade = getUpgradeCost(item);
    const canUpgrade = upgrade && hasUpgradeMaterials(upgrade.costs);
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
            <div class="gear-upgrade-cost">${upgrade ? formatMaterialCost(upgrade.costs) : 'Potenziamento massimo raggiunto'}</div>
          </div>
          <button class="btn ${canUpgrade ? '' : 'ghost'}" data-upgrade-item="${item.id}" ${upgrade ? '' : 'disabled'}>${upgrade ? 'Forge' : 'MAX'}</button>
        </div>
      </div>`;
  }).join('') : '<div class="gear-empty-state">Nessun flask trovato. Alcune special quest e alcuni boss possono sbloccarli.</div>';

  slotsEl.querySelectorAll('[data-unequip-slot]').forEach(btn => btn.addEventListener('click', () => unequipItem(btn.dataset.unequipSlot)));
  inventoryEl.querySelectorAll('[data-equip-item]').forEach(btn => btn.addEventListener('click', () => equipItem(btn.dataset.equipItem)));
  consumablesEl.querySelectorAll('[data-use-flask]').forEach(btn => btn.addEventListener('click', () => useFlask(btn.dataset.useFlask)));
  [...inventoryEl.querySelectorAll('[data-upgrade-item]'), ...consumablesEl.querySelectorAll('[data-upgrade-item]')].forEach(btn => btn.addEventListener('click', () => upgradeEquipmentItem(btn.dataset.upgradeItem)));

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
  const g = $('bossGrid');
  g.innerHTML = BOSS_DEFINITIONS.map(b => {
    const dead = state.bossesDefeated.includes(b.id);
    const locked = !meetsReq(b.req);
    const cls = dead ? 'defeated' : (locked ? 'locked' : '');
    let stHtml;
    if (dead) stHtml = '<span class="bc-status st-dead">☠ SCONFITTO</span>';
    else if (locked) stHtml = '<span class="bc-status st-lock">🔒 LOCKED</span>';
    else stHtml = '<span class="bc-status st-ready">⚔ ENGAGE</span>';
    return `
      <div class="boss-card ${cls}" data-boss-id="${b.id}">
        <div class="bc-icon">${b.icon}</div>
        <div class="bc-name">${b.name}</div>
        <div class="bc-lv">LV. ${b.level}</div>
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

function startBossFight(boss) {
  activeBoss = boss;
  activeBossHP = 100;
  activeBossStep = 0;
  $('bossListView').classList.remove('active');
  $('bossFightView').classList.add('active');
  const n = $('bossFightName');
  n.textContent = boss.name;
  n.dataset.text = boss.name;
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
  const step = activeBoss.protocol[activeBossStep];
  if (!step) return;
  $('protocolLbl').textContent = `Step ${activeBossStep+1}/${activeBoss.protocol.length}`;
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
  const step = activeBoss.protocol[activeBossStep];
  if (!step) return;
  startTimer(step.dur, () => {
    const dmg = 100 / activeBoss.protocol.length;
    activeBossHP -= dmg;
    updateBossHP();
    triggerGlitch();
    if (activeBossHP <= 0) { defeatBoss(); }
    else {
      activeBossStep++;
      if (activeBossStep < activeBoss.protocol.length) loadBossStep();
      else { activeBossHP = 0; updateBossHP(); defeatBoss(); }
    }
  });
});

$('btnRetreat').addEventListener('click', () => {
  if (bossTimer) { clearInterval(bossTimer); bossTimer = null; }
  activeBoss = null;
  $('bossFightView').classList.remove('active');
  $('bossListView').classList.add('active');
  renderBossGrid();
});

function defeatBoss() {
  if (!activeBoss) return;
  const boss = activeBoss;
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

  const bossDrop = rollLootTable(BOSS_DROP_TABLES[boss.id] || []);
  if (bossDrop) awardEquipment(bossDrop);
  const setUpgrade = BOSS_SET_UPGRADES[boss.id];
  if (setUpgrade) grantSetUpgrade(setUpgrade.setId, setUpgrade.bonuses, boss.name);
  awardMaterial('BOSS_CORE', 2, boss.name);
  saveState();

  // Show rewards
  const rewLines = boss.rewards.map(r => {
    const s = [...PRIMARY_STATS,...SECONDARY_STATS].find(s=>s.id===r.stat);
    const eff = Math.floor(r.xp * 1.5 * (1+Math.min(state.currentStreak*0.05, 0.5)));
    return `${s?.icon||''} ${s?.name||r.stat}: +${eff} XP`;
  }).join('<br>');
  const bossDropLine = bossDrop ? `<br><br><strong>DROP:</strong> ${EQUIPMENT_CATALOG[bossDrop]?.icon || '✦'} ${EQUIPMENT_CATALOG[bossDrop]?.name || bossDrop}` : '';
  const setUpgradeLine = setUpgrade ? `<br><strong>UPGRADE SET:</strong> ${EQUIPMENT_SET_BONUSES[setUpgrade.setId]?.name || setUpgrade.setId} · ${Object.entries(setUpgrade.bonuses).map(([stat, amount]) => `+${amount} ${stat}`).join(' · ')}` : '';
  $('defDetail').innerHTML = `${boss.icon} ${boss.name} SCONFITTO!<br><br>${rewLines}<br><br><strong>TOTALE: +${totalXP} XP</strong>${bossDropLine}${setUpgradeLine}`;
  $('bossDefeatOverlay').classList.remove('hidden');
  triggerGlitch();
  showToast(`☠ ${boss.name} SCONFITTO!`, 'levelup');
  showToast(`+${totalXP} XP`, 'xp');
  if (anyLvl) { showToast('LEVEL UP!','levelup'); showLevelUpOverlay(); }

  // Update status and check achievements
  renderStatus();
  checkAchievements();
  activeBoss = null;
}

$('btnDismissDef').addEventListener('click', () => {
  $('bossDefeatOverlay').classList.add('hidden');
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

    const xpPreview = !done ? `<div class="diff-mode-selector" data-qid="${q.id}">
      ${Object.entries(DIFFICULTY_MODES).map(([k,m]) => {
        const diffEff = Math.max(1, q.diff + m.diffOffset);
        const mRarity = getQuestRarity(diffEff);
        const mRarityMult = RARITY_MULT[mRarity];
        let mXP = 0;
        for (const rew of q.rewards) {
          const pen = getDebuffPenalty(rew.stat);
          let eff = calcXP(rew.xp, diffEff, state.currentStreak, pen);
          eff = Math.round(eff * mRarityMult * m.xpMult);
          mXP += eff;
        }
        return `<button class="diff-mode-btn" data-mode="${k}" data-qid="${q.id}" style="border-color:${m.color}"><span class="dm-icon">${m.icon}</span><span class="dm-label">${m.label}</span><span class="dm-xp">+${mXP}</span></button>`;
      }).join('')}
    </div>` : '';

    return `
      <div class="quest-card ${cls} rarity-border-${rarity.toLowerCase()}" data-quest-id="${q.id}" data-cat="${q.cat}">
        <div class="q-check">${done ? '✓' : ''}</div>
        <span class="q-icon">${q.icon}</span>
        <div class="q-body">
          <div class="q-name">${q.name} ${customTag} ${timedTag} ${doneModeBadge}</div>
          <div class="q-tags">${rarityTag}<span class="q-cat-tag">${q.cat}</span></div>
          <div class="q-desc">${q.desc || ''}</div>
          <div class="q-meta"><span class="q-dur">${q.dur} min</span><span class="q-xp">+${(() => { const de = Math.max(1, q.diff); const rr = RARITY_MULT[getQuestRarity(de)]; let t = 0; for (const r of q.rewards) { t += Math.round(calcXP(r.xp, de, state.currentStreak, getDebuffPenalty(r.stat)) * rr); } return t; })()} XP</span></div>
          ${xpPreview}
          <div class="q-detail" id="detail-${q.id}">
            <ol>${(q.protocol||[]).map(p=>`<li>${p}</li>`).join('')}</ol>
            <div class="cq-card-actions">
              <button class="btn-secondary cq-edit-btn" data-id="${q.id}">✏ MODIFICA</button>
              <button class="btn-danger cq-del-btn" data-id="${q.id}">🗑 ELIMINA</button>
            </div>
          </div>
        </div>
        <div class="q-rank rk-${rank}">${rank}</div>
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

  // Card click: toggle detail
  listEl.querySelectorAll('.quest-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.diff-mode-btn') || e.target.closest('.cq-edit-btn') || e.target.closest('.cq-del-btn')) return;
      const qid = card.dataset.questId;
      const p = $('detail-'+qid);
      if (p) p.classList.toggle('open');
    });
  });
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

// ========================
// COMPANION CHAT
// ========================

function initCompanion() {
  $('chatSend').addEventListener('click', sendChat);
  $('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });
  // AI config buttons
  const cfgBtn = $('btnAiConfig');
  if (cfgBtn) cfgBtn.addEventListener('click', openAiConfig);
  const saveKeyBtn = $('btnSaveAiKey');
  if (saveKeyBtn) saveKeyBtn.addEventListener('click', () => {
    const key = $('aiApiKey').value.trim();
    const model = $('aiModelSelect').value.trim();
    setAiApiKey(key);
    if (model) setAiModel(model);
    $('aiConfigModal').classList.add('hidden');
    showToast(key ? 'API Key salvata!' : 'API Key rimossa', 'success');
  });
  const cancelCfg = $('btnCancelAiConfig');
  if (cancelCfg) cancelCfg.addEventListener('click', () => {
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
  });
}

function renderAssessResult(input, ans, debuffs) {
  $('assessForm').style.display = 'none';
  $('assessResult').classList.remove('hidden');

  const badge = $('ansBadge');
  badge.textContent = ans.replace(/_/g,' ');
  badge.className = 'ans-badge';
  if (ans==='SYMPATHETIC') badge.classList.add('symp');
  else if (ans==='PARASYMPATHETIC') badge.classList.add('para');

  // Metrics
  const met = $('assessMetrics');
  met.innerHTML = `
    <div class="am-card"><div class="am-label">HRV</div><div class="am-value">${input.hrv}ms</div></div>
    <div class="am-card"><div class="am-label">BOLT</div><div class="am-value">${input.bolt}s</div></div>
    <div class="am-card"><div class="am-label">MOOD</div><div class="am-value">${input.mood}/10</div></div>
    <div class="am-card"><div class="am-label">ENERGY</div><div class="am-value">${input.energy}/10</div></div>
    <div class="am-card"><div class="am-label">SLEEP</div><div class="am-value">${input.sleep}/10</div></div>
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

  initStats();
  resetWeeklyIfNeeded();
  cleanExpiredBuffs();
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
