/* ============================================
   NEURO-LEVELING v2 — Full Game Logic
   ============================================ */

// ========================
// AUTH & PERSISTENCE
// ========================

let currentUser = null;
let _saveTimeout = null;

function $(id) { return document.getElementById(id); }

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

// Login con Google
async function googleLogin() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) showAuthError(getSupabaseErrorMessage(error.message));
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
  await supabaseClient.auth.signOut();
}

// Carica stato da Supabase, con fallback su localStorage
async function loadStateFromCloud(uid) {
  try {
    const { data, error } = await supabaseClient
      .from('players')
      .select('state')
      .eq('id', uid)
      .single();
    if (data && data.state) {
      return { ...DEFAULT_STATE, ...data.state };
    }
    // Migra da localStorage se esiste
    const local = localStorage.getItem('neuro_leveling_v2');
    if (local) {
      const parsed = { ...DEFAULT_STATE, ...JSON.parse(local) };
      await supabaseClient.from('players').upsert({ id: uid, state: parsed });
      return parsed;
    }
  } catch (e) {
    console.error('Supabase load error:', e);
    const local = localStorage.getItem('neuro_leveling_v2');
    if (local) return { ...DEFAULT_STATE, ...JSON.parse(local) };
  }
  return { ...DEFAULT_STATE };
}

// Salva su Supabase + localStorage (debounced)
function saveState() {
  localStorage.setItem('neuro_leveling_v2', JSON.stringify(state));
  if (!currentUser) return;
  clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    supabaseClient.from('players').upsert({ id: currentUser.id, state: state })
      .then(({ error }) => { if (error) console.error('Supabase save error:', error); });
  }, 1000);
}

// Auth state listener — entry point dell'app
let _authInitialized = false;
supabaseClient.auth.onAuthStateChange(async (event, session) => {
  // Aspetta che il DOM sia pronto
  if (document.readyState === 'loading') {
    await new Promise(r => document.addEventListener('DOMContentLoaded', r));
  }
  if (session && session.user) {
    currentUser = session.user;
    $('loginScreen').classList.add('hidden');
    // Mostra info utente
    const meta = currentUser.user_metadata || {};
    $('userAvatar').src = meta.avatar_url || meta.picture || '';
    $('userEmail').textContent = currentUser.email || '';
    // Carica dati dal cloud
    state = await loadStateFromCloud(currentUser.id);
    init();
  } else {
    currentUser = null;
    if ($('loginScreen')) {
      $('loginScreen').classList.remove('hidden');
      $('onboarding').classList.add('hidden');
      $('mainApp').classList.add('hidden');
    }
  }
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
      const cats = done.map(id => QUEST_DEFINITIONS.find(q=>q.id===id)?.cat).filter(Boolean);
      return cats.includes('PHYSIQUE') && cats.includes('COGNITIVE');
    }, bonusXP:50, bonusStat:'ADA',
  },
  {
    id:'full_spectrum', name:'FULL SPECTRUM', desc:'1 per ogni categoria', icon:'🌈',
    check: (done) => {
      const cats = new Set(done.map(id => QUEST_DEFINITIONS.find(q=>q.id===id)?.cat).filter(Boolean));
      return cats.has('PHYSIQUE') && cats.has('COGNITIVE') && cats.has('NEURAL') && cats.has('SOCIAL');
    }, bonusXP:100, bonusStat:'VIT',
  },
  {
    id:'iron_will', name:'VOLONTÀ DI FERRO', desc:'3+ quest diff ≥ 6', icon:'🔥',
    check: (done) => done.filter(id => (QUEST_DEFINITIONS.find(x=>x.id===id)?.diff??0) >= 6).length >= 3,
    bonusXP:80, bonusStat:'WIL',
  },
  {
    id:'recovery_master', name:'RECUPERO TOTALE', desc:'2+ quest recovery/facili', icon:'💚',
    check: (done) => done.filter(id => { const q=QUEST_DEFINITIONS.find(x=>x.id===id); return q&&(q.type==='RECOVERY'||q.diff<=3); }).length >= 2,
    bonusXP:40, bonusStat:'VAG',
  },
  {
    id:'social_butterfly', name:'FARFALLA SOCIALE', desc:'2+ quest SOCIAL', icon:'🦋',
    check: (done) => done.filter(id => QUEST_DEFINITIONS.find(x=>x.id===id)?.cat==='SOCIAL').length >= 2,
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
  { id:'class_10',     name:'CLASS ASCENSION',  icon:'🌟', desc:'Livello classe 10.',           check:s=>getClassLevel()>=10 },
  { id:'lv_30',        name:'SHADOW ADEPT',     icon:'🌑', desc:'Livello totale 30+.',          check:s=>getTotalLevel()>=30 },
  { id:'lv_60',        name:'MONARCH',          icon:'👁', desc:'Livello totale 60+.',          check:s=>getTotalLevel()>=60 },
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
  questTab: 'daily',
};

let state = { ...DEFAULT_STATE };

function loadState() {
  try {
    const s = localStorage.getItem('neuro_leveling_v2');
    if (s) { const p = JSON.parse(s); return { ...DEFAULT_STATE, ...p }; }
  } catch(_){}
  return { ...DEFAULT_STATE };
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

function xpForLevel(lv) { return Math.floor(100 * Math.pow(lv, 1.5)); }

function getStatLv(id) { return state.stats[id]?.lv ?? 1; }

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
  return PRIMARY_STATS.reduce((a,s) => a + getStatLv(s.id), 0);
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
  return reqs.every(r => getStatLv(r.stat) >= r.minLv);
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
    const cats = new Set(state.todayCompleted.map(id => QUEST_DEFINITIONS.find(x=>x.id===id)?.cat).filter(Boolean));
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
  let sum = 0;
  for (const pid of cl.primary) sum += getStatLv(pid);
  // secondary stats that derive from primary
  for (const s of SECONDARY_STATS) {
    if (s.derivedFrom.some(d => cl.primary.includes(d))) sum += Math.floor(getStatLv(s.id) * 0.5);
  }
  return Math.max(1, Math.floor(sum / cl.primary.length));
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
  const rest = isForcedRest();
  if (rest) return QUEST_DEFINITIONS.filter(q=>q.type==='RECOVERY');
  return QUEST_DEFINITIONS.filter(q => {
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
// COMPANION AI  (local deterministic)
// ========================

function companionReply(msg) {
  const m = msg.toLowerCase().trim();
  const lv = getTotalLevel();
  const cls = CLASS_DEFINITIONS.find(c=>c.id===state.playerClass);
  const clsName = cls?.name ?? 'Hunter';
  const streak = state.currentStreak;
  const lastA = state.assessmentHistory[state.assessmentHistory.length-1];
  const debuffs = state.activeDebuffs;

  // Greetings
  if (/^(ciao|hey|salve|buon)/.test(m))
    return `Salve, ${clsName}. Livello totale ${lv}, streak di ${streak} giorni. Come posso aiutarti?`;

  // Stats / Status
  if (/stat|livell|level|punti|profilo|come sto/.test(m)) {
    const top3 = [...PRIMARY_STATS].sort((a,b)=>getStatLv(b.id)-getStatLv(a.id)).slice(0,3);
    const weak = [...PRIMARY_STATS].sort((a,b)=>getStatLv(a.id)-getStatLv(b.id))[0];
    return `Le tue stat migliori: ${top3.map(s=>`${s.name} LV.${getStatLv(s.id)}`).join(', ')}. ` +
      `Punto debole: ${weak.name} LV.${getStatLv(weak.id)}. Ti consiglio di lavorarci con quest mirate.`;
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
    return `La tua classe è ${clsName} (LV.${getClassLevel()}). Ogni punto nelle stat primarie della classe accelera la progressione. Continua a fare quest allineate al tuo percorso.`;

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
    `Il tuo livello totale è ${lv}. Ogni quest completata ti avvicina al prossimo titolo.`,
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
  $('onbEnter').addEventListener('click', () => {
    state.onboardingDone = true;
    saveState();
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

  // Determine class
  const cl = determineClass(primaryMap);
  state.playerClass = cl.id;
  state.classLevel = 1;
  saveState();

  // Show reveal
  $('classIcon').textContent = cl.icon;
  $('className').textContent = cl.name;
  $('className').dataset.text = cl.name;
  $('classDesc').textContent = cl.desc;

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
  $$('.screen').forEach(s => s.classList.remove('active'));
  const el = $('screen' + name.charAt(0).toUpperCase() + name.slice(1));
  if (el) el.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  triggerGlitch();

  if (name==='status') renderStatus();
  else if (name==='quests') renderQuests();
  else if (name==='boss') renderBossGrid();
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

// ========================
// RENDER: STATUS
// ========================

function renderStatus() {
  const nm = $('playerNameLg');
  nm.textContent = state.playerName || 'HUNTER';
  nm.dataset.text = nm.textContent;

  const cl = CLASS_DEFINITIONS.find(c=>c.id===state.playerClass);
  $('playerClassBadge').textContent = cl ? `${cl.icon} ${cl.name} LV.${getClassLevel()}` : '';
  $('playerTitleBar').textContent = getTitle();
  $('totalLvPill').textContent = getTotalLevel();

  // XP bar (next total level)
  const totalLv = getTotalLevel();
  const xpNext = xpForLevel(totalLv+1);
  // Approximate XP by summing residual xp across primary stats
  const xpCur = PRIMARY_STATS.reduce((a,s) => a + (state.stats[s.id]?.xp ?? 0), 0);
  const pct = Math.min((xpCur / Math.max(xpNext,1)) * 100, 100);
  $('xpBarFill').style.width = pct+'%';
  $('xpCur').textContent = xpCur;
  $('xpNext').textContent = xpNext;

  // Primary stats
  const priEl = $('statsPrimary');
  priEl.innerHTML = PRIMARY_STATS.map(s => {
    const lv = getStatLv(s.id);
    const xpN = xpForLevel(lv+1);
    const xpC = state.stats[s.id]?.xp ?? 0;
    const pct = Math.min((xpC/Math.max(xpN,1))*100, 100);
    return `<div class="stat-row">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-info">
        <div class="stat-name"><span class="stat-name-txt">${s.name}</span><span class="stat-lv" style="color:${s.color}">LV.${lv}</span></div>
        <div class="stat-bar-wrap"><div class="stat-bar-fill" style="width:${pct}%;background:${s.color}"></div></div>
      </div>
    </div>`;
  }).join('');

  // Secondary stats
  const secEl = $('statsSecondary');
  secEl.innerHTML = SECONDARY_STATS.map(s => {
    const lv = getStatLv(s.id);
    const xpN = xpForLevel(lv+1);
    const xpC = state.stats[s.id]?.xp ?? 0;
    const pct = Math.min((xpC/Math.max(xpN,1))*100, 100);
    return `<div class="stat-row">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-info">
        <div class="stat-name"><span class="stat-name-txt">${s.name}</span><span class="stat-lv" style="color:${s.color}">LV.${lv}</span></div>
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
let questTab = 'daily';

function renderQuestTabs() {
  const tabs = $('questTabs');
  if (!tabs) return;
  tabs.innerHTML = ['daily','weekly','chains'].map(t => {
    const labels = { daily:'DAILY', weekly:'WEEKLY', chains:'CHAINS' };
    const active = questTab === t ? 'tab-active' : '';
    return `<button class="quest-tab ${active}" data-tab="${t}">${labels[t]}</button>`;
  }).join('');
  tabs.querySelectorAll('.quest-tab').forEach(btn => {
    btn.addEventListener('click', () => { questTab = btn.dataset.tab; renderQuests(); });
  });
}

function renderQuests() {
  renderQuestTabs();
  const dailyBonus = getDailyBonus();
  if (questTab === 'daily') renderDailyQuests(dailyBonus);
  else if (questTab === 'weekly') renderWeeklyQuests();
  else renderChainQuests();
  renderActiveBuffsBanner();
  renderComboTracker();
}

function renderDailyQuests(dailyBonus) {
  const lastA = state.assessmentHistory[state.assessmentHistory.length-1] || null;
  currentQuests = getAvailableQuests(lastA);

  const listEl = $('questList');
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

    // XP preview for each mode
    const xpPreview = !done && !locked ? `<div class="diff-mode-selector" data-qid="${q.id}">
      ${Object.entries(DIFFICULTY_MODES).map(([k,m]) => {
        const mXP = Math.round(totalRew * m.xpMult);
        return `<button class="diff-mode-btn" data-mode="${k}" data-qid="${q.id}" style="border-color:${m.color}"><span class="dm-icon">${m.icon}</span><span class="dm-label">${m.label}</span><span class="dm-xp">+${mXP}</span></button>`;
      }).join('')}
    </div>` : '';

    return `
      <div class="quest-card ${cls} rarity-border-${rarity.toLowerCase()}" data-quest-id="${q.id}" data-cat="${q.cat}">
        <div class="q-check">${done ? '✓' : (locked ? '🔒' : '')}</div>
        <span class="q-icon">${q.icon}</span>
        <div class="q-body">
          <div class="q-name">${q.name} ${bonusTag} ${timedTag} ${doneModeBadge}</div>
          <div class="q-tags">${rarityTag}<span class="q-cat-tag">${q.cat}</span></div>
          <div class="q-desc">${q.desc}</div>
          <div class="q-meta"><span class="q-dur">${q.dur} min</span><span class="q-xp">+${totalRew} XP</span></div>
          ${xpPreview}
          <div class="q-detail" id="detail-${q.id}">
            <ol>${q.protocol.map(p=>`<li>${p}</li>`).join('')}</ol>
            <div class="q-sci">${q.science}</div>
          </div>
        </div>
        <div class="q-rank rk-${rank}">${rank}</div>
      </div>`;
  }).join('');

  const total = currentQuests.length;
  const done = currentQuests.filter(q => getDoneInfo(q.id)).length;
  const pct = total > 0 ? Math.round((done/total)*100) : 0;
  $('qpFill').style.width = pct+'%';
  $('qpText').textContent = `${done} / ${total}`;
  const totalXP = currentQuests.reduce((a,q) => a + q.rewards.reduce((b,r) => b + r.xp, 0), 0);
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

function getDoneInfo(qid) {
  return (state.todayCompletedDetails || []).find(d => d.id === qid) || (state.todayCompleted.includes(qid) ? { id:qid, mode:'medium' } : null);
}

// Timed quest state
let activeTimedQuest = null;
let timedQuestStart = 0;
let timedQuestInterval = null;

function startQuestWithMode(qid, mode) {
  const quest = QUEST_DEFINITIONS.find(q=>q.id===qid);
  if (!quest) return;
  if (!meetsReq(quest.req)) { showToast('Requisiti non soddisfatti','alert'); return; }
  if (getDoneInfo(qid)) { showToast('Quest già completata oggi','alert'); return; }

  if (quest.timed) {
    // Open timed quest overlay
    activeTimedQuest = { quest, mode };
    timedQuestStart = 0;
    showTimedQuestOverlay(quest, mode);
  } else {
    // Direct completion
    completeQuest(quest, mode, 1.0);
  }
}

function showTimedQuestOverlay(quest, mode) {
  const ov = $('timedQuestOverlay');
  if (!ov) return;
  const modeInfo = DIFFICULTY_MODES[mode];
  const targetMin = quest.dur;
  $('tqName').textContent = quest.name;
  $('tqMode').textContent = modeInfo.label;
  $('tqMode').style.color = modeInfo.color;
  $('tqTarget').textContent = `Obiettivo: ${targetMin} min`;
  $('tqElapsed').textContent = '00:00';
  $('tqBonusPrev').textContent = 'Avvia per iniziare';
  $('btnTqStart').classList.remove('hidden');
  $('btnTqStop').classList.add('hidden');
  $('tqProtocol').innerHTML = `<ol>${quest.protocol.map(p=>`<li>${p}</li>`).join('')}</ol>`;
  ov.classList.remove('hidden');
}

function startTimedQuest() {
  timedQuestStart = Date.now();
  $('btnTqStart').classList.add('hidden');
  $('btnTqStop').classList.remove('hidden');
  if (timedQuestInterval) clearInterval(timedQuestInterval);
  timedQuestInterval = setInterval(updateTimedQuestDisplay, 1000);
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
  if (timedQuestInterval) { clearInterval(timedQuestInterval); timedQuestInterval = null; }
  if (!activeTimedQuest || !timedQuestStart) return;
  const elapsed = Math.floor((Date.now() - timedQuestStart) / 1000);
  const timeBonus = calcTimeBonus(activeTimedQuest.quest, elapsed);
  const { quest, mode } = activeTimedQuest;
  $('timedQuestOverlay').classList.add('hidden');
  activeTimedQuest = null;
  timedQuestStart = 0;
  completeQuest(quest, mode, timeBonus);
}

function cancelTimedQuest() {
  if (timedQuestInterval) { clearInterval(timedQuestInterval); timedQuestInterval = null; }
  activeTimedQuest = null;
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
  state.todayCompletedDetails.push({ id:quest.id, mode, timeBonus });

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
  saveState();

  // Show rewards
  const rewLines = boss.rewards.map(r => {
    const s = [...PRIMARY_STATS,...SECONDARY_STATS].find(s=>s.id===r.stat);
    const eff = Math.floor(r.xp * 1.5 * (1+Math.min(state.currentStreak*0.05, 0.5)));
    return `${s?.icon||''} ${s?.name||r.stat}: +${eff} XP`;
  }).join('<br>');
  $('defDetail').innerHTML = `${boss.icon} ${boss.name} SCONFITTO!<br><br>${rewLines}<br><br><strong>TOTALE: +${totalXP} XP</strong>`;
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
// COMPANION CHAT
// ========================

function initCompanion() {
  $('chatSend').addEventListener('click', sendChat);
  $('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });
}

function sendChat() {
  const input = $('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  addChatMsg(msg, 'user');
  setTimeout(() => {
    const reply = companionReply(msg);
    addChatMsg(reply, 'bot');
  }, 400+Math.random()*600);
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
  $('lvlDetail').innerHTML = `${getTitle()}<br>Livello Totale: ${getTotalLevel()}`;
  o.classList.remove('hidden');
}

$('btnDismissLvl').addEventListener('click', () => {
  $('levelUpOverlay').classList.add('hidden');
});

// ========================
// INIT
// ========================

function init() {
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

  initStats();
  resetWeeklyIfNeeded();
  cleanExpiredBuffs();
  initOnboarding();
  initCompanion();
  initAssessment();
  initTimedQuestOverlay();
  if (state.onboardingDone) {
    renderStatus();
    checkAchievements();
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
