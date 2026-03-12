// ============================================
// NEURO-LEVELING — Boss Model
// ============================================
import { EmotionalBossType, SkillCategory, BossFightPhase } from '../types';

export interface BossSkillRequirement {
  skillId: string;
  minLevel: number;
}

export interface BossProtocolStep {
  instruction: string;
  durationSeconds: number;
  targetEffect: string;
}

export interface BossDefinition {
  id: EmotionalBossType;
  name: string;
  title: string;
  description: string;
  neurologicalProfile: string;
  maxHP: number;
  requirements: BossSkillRequirement[];
  weaknesses: SkillCategory[];
  battleProtocol: BossProtocolStep[];
  defeatRewards: { skillId: string; xp: number }[];
  level: number;
}

export class Boss {
  id: EmotionalBossType;
  name: string;
  title: string;
  description: string;
  neurologicalProfile: string;
  maxHP: number;
  currentHP: number;
  requirements: BossSkillRequirement[];
  weaknesses: SkillCategory[];
  battleProtocol: BossProtocolStep[];
  defeatRewards: { skillId: string; xp: number }[];
  phase: BossFightPhase;
  level: number;
  currentProtocolStep: number;

  constructor(definition: BossDefinition) {
    this.id = definition.id;
    this.name = definition.name;
    this.title = definition.title;
    this.description = definition.description;
    this.neurologicalProfile = definition.neurologicalProfile;
    this.maxHP = definition.maxHP;
    this.currentHP = definition.maxHP;
    this.requirements = definition.requirements;
    this.weaknesses = definition.weaknesses;
    this.battleProtocol = definition.battleProtocol;
    this.defeatRewards = definition.defeatRewards;
    this.phase = 'LOCKED';
    this.level = definition.level;
    this.currentProtocolStep = 0;
  }

  /**
   * Verifica se il Player soddisfa i requisiti per affrontare il Boss
   */
  checkRequirements(playerSkillLevels: Map<string, number>): boolean {
    return this.requirements.every((req) => {
      const playerLevel = playerSkillLevels.get(req.skillId) ?? 0;
      return playerLevel >= req.minLevel;
    });
  }

  /**
   * Inizia la fase di battaglia
   */
  engage(): boolean {
    if (this.phase !== 'READY') return false;
    this.phase = 'IN_BATTLE';
    this.currentHP = this.maxHP;
    this.currentProtocolStep = 0;
    return true;
  }

  /**
   * Esegui il prossimo step del protocollo — riduce HP del Boss
   */
  executeProtocolStep(): BossProtocolStep | null {
    if (this.phase !== 'IN_BATTLE') return null;
    if (this.currentProtocolStep >= this.battleProtocol.length) return null;

    const step = this.battleProtocol[this.currentProtocolStep];
    const damage = Math.floor(this.maxHP / this.battleProtocol.length);
    this.currentHP = Math.max(0, this.currentHP - damage);
    this.currentProtocolStep++;

    if (this.currentHP <= 0) {
      this.phase = 'DEFEATED';
    }

    return step;
  }

  /**
   * Ritirata dalla battaglia
   */
  retreat(): void {
    if (this.phase === 'IN_BATTLE') {
      this.phase = 'RETREATED';
    }
  }

  get isDefeated(): boolean {
    return this.phase === 'DEFEATED';
  }

  get hpPercent(): number {
    return (this.currentHP / this.maxHP) * 100;
  }

  get remainingSteps(): number {
    return this.battleProtocol.length - this.currentProtocolStep;
  }
}

// ============================================
// Boss Predefiniti — Emotional Overlords
// ============================================

export const BOSS_DEFINITIONS: BossDefinition[] = [
  {
    id: 'ANXIETY_WRAITH',
    name: 'Anxiety Wraith',
    title: 'Lo Spettro dell\'Ansia',
    description: 'Un\'entità che si nutre dei segnali di errore del sistema predittivo del cervello. Distorce la percezione del pericolo.',
    neurologicalProfile: 'Iperattivazione dell\'amigdala con compromissione della corteccia prefrontale mediale. Loop di feedback positivo tra insula e sistema simpatico.',
    maxHP: 100,
    level: 1,
    requirements: [
      { skillId: 'soc_vagal_tone', minLevel: 5 },
      { skillId: 'phys_co2_tolerance', minLevel: 3 },
    ],
    weaknesses: ['SOCIAL', 'PHYSIQUE'],
    battleProtocol: [
      {
        instruction: 'BOX BREATHING: Inspira 4s → Trattieni 4s → Espira 4s → Trattieni 4s. Ripeti 6 volte.',
        durationSeconds: 120,
        targetEffect: 'Attivazione del baroriflesso e riduzione del tono simpatico.',
      },
      {
        instruction: 'GROUNDING 5-4-3-2-1: Nomina 5 cose che vedi, 4 che tocchi, 3 che senti, 2 che annusi, 1 che gusti.',
        durationSeconds: 60,
        targetEffect: 'Riancoraggio alla corteccia sensoriale, bypass dell\'amigdala.',
      },
      {
        instruction: 'COLD EXPOSURE: Immergi il viso in acqua fredda (10-15°C) per 30 secondi.',
        durationSeconds: 45,
        targetEffect: 'Dive reflex: bradicardia riflessa via nervo trigemino → nucleo del vago.',
      },
      {
        instruction: 'COGNITIVE REFRAME: Verbalizza ad alta voce "Questo è un segnale di attivazione, non di pericolo reale."',
        durationSeconds: 30,
        targetEffect: 'Attivazione della corteccia prefrontale ventromediale per modulazione top-down dell\'amigdala.',
      },
      {
        instruction: 'VAGAL BRAKE: Espirazione prolungata 4s-in / 8s-out per 3 minuti.',
        durationSeconds: 180,
        targetEffect: 'Massima attivazione parasimpatica tramite allungamento espiratorio.',
      },
    ],
    defeatRewards: [
      { skillId: 'soc_vagal_tone', xp: 100 },
      { skillId: 'soc_cardiac_coherence', xp: 75 },
      { skillId: 'phys_co2_tolerance', xp: 50 },
      { skillId: 'cog_deep_focus', xp: 40 },
    ],
  },
  {
    id: 'LETHARGY_GOLEM',
    name: 'Lethargy Golem',
    title: 'Il Golem della Letargia',
    description: 'Massa inerte che drena ogni motivazione. Rallenta il metabolismo e offusca la mente.',
    neurologicalProfile: 'Down-regulation dopaminergica nel circuito mesolimbico. Elevato adenosina residua. Ridotta attività del locus coeruleus.',
    maxHP: 120,
    level: 2,
    requirements: [
      { skillId: 'phys_cardio_output', minLevel: 4 },
      { skillId: 'cog_deep_focus', minLevel: 3 },
    ],
    weaknesses: ['PHYSIQUE', 'COGNITIVE'],
    battleProtocol: [
      {
        instruction: 'COLD SHOWER BLAST: 60 secondi di doccia ghiacciata. Mantieni respirazione nasale.',
        durationSeconds: 90,
        targetEffect: 'Spike di norepinefrina (+200-300%) per riattivazione del locus coeruleus.',
      },
      {
        instruction: 'MOVEMENT PRIME: 20 jumping jacks + 10 squat esplosivi + 10 push-ups.',
        durationSeconds: 120,
        targetEffect: 'Aumento del BDNF e attivazione del sistema reticolare ascendente.',
      },
      {
        instruction: 'SUNLIGHT EXPOSURE: 10 minuti di esposizione alla luce solare diretta (senza occhiali).',
        durationSeconds: 600,
        targetEffect: 'Soppressione della melatonina e fase-advance del ritmo circadiano via cellule retiniche ipRGC.',
      },
      {
        instruction: 'MICRO-COMMITMENT: Scegli UNA azione da 2 minuti e completala ORA.',
        durationSeconds: 120,
        targetEffect: 'Innesco del circuito di reward prediction error per generare momentum dopaminergico.',
      },
    ],
    defeatRewards: [
      { skillId: 'phys_cardio_output', xp: 80 },
      { skillId: 'cog_deep_focus', xp: 70 },
      { skillId: 'cog_processing_speed', xp: 50 },
    ],
  },
  {
    id: 'ANGER_BERSERKER',
    name: 'Anger Berserker',
    title: 'Il Berserker della Rabbia',
    description: 'Forza bruta che consuma energia e distrugge relazioni. Dominio simpatico incontrollato.',
    neurologicalProfile: 'Disinibizione dell\'amigdala laterale con bypass della corteccia orbitofrontale. Eccesso di norepinefrina e testosterone con cortisolo cronico.',
    maxHP: 150,
    level: 3,
    requirements: [
      { skillId: 'soc_vagal_tone', minLevel: 7 },
      { skillId: 'soc_cognitive_empathy', minLevel: 5 },
      { skillId: 'phys_co2_tolerance', minLevel: 5 },
    ],
    weaknesses: ['SOCIAL', 'NEURAL'],
    battleProtocol: [
      {
        instruction: 'PHYSIOLOGICAL SIGH: Doppia inspirazione nasale rapida + espirazione lenta orale. Ripeti 8 volte.',
        durationSeconds: 60,
        targetEffect: 'Reset dei chemocettori polmonari e attivazione del pre-Bötzinger complex per calma fisiologica.',
      },
      {
        instruction: 'BILATERAL STIMULATION: Tapping alternato sulle ginocchia, 1 Hz, per 2 minuti con occhi chiusi.',
        durationSeconds: 120,
        targetEffect: 'Desensibilizzazione della carica emotiva via connessioni interemsferiche (simile EMDR).',
      },
      {
        instruction: 'PERSPECTIVE SHIFT: Descrivi la situazione in terza persona, come un narratore neutrale.',
        durationSeconds: 90,
        targetEffect: 'Attivazione della corteccia prefrontale mediale per auto-distanziamento (self-distancing di Kross).',
      },
      {
        instruction: 'ISOMETRIC TENSION RELEASE: Contrai tutti i muscoli al 100% per 10s, poi rilascia completamente. 3 volte.',
        durationSeconds: 60,
        targetEffect: 'Rilascio di acetilcolina muscarinica post-contrazione per reset del tono muscolare e simpatico.',
      },
    ],
    defeatRewards: [
      { skillId: 'soc_vagal_tone', xp: 120 },
      { skillId: 'soc_cognitive_empathy', xp: 80 },
      { skillId: 'neural_pain_modulation', xp: 60 },
    ],
  },
  {
    id: 'DESPAIR_PHANTOM',
    name: 'Despair Phantom',
    title: 'Il Fantasma della Disperazione',
    description: 'Un\'ombra che svuota di significato ogni azione. Paralisi motivazionale profonda.',
    neurologicalProfile: 'Deplezione serotoninergica nel nucleo del rafe dorsale. Iperfunzione del network di default (rumination). Disconnessione dello striato ventrale dal reward circuit.',
    maxHP: 180,
    level: 4,
    requirements: [
      { skillId: 'soc_vagal_tone', minLevel: 8 },
      { skillId: 'cog_deep_focus', minLevel: 6 },
      { skillId: 'phys_cardio_output', minLevel: 5 },
      { skillId: 'soc_cognitive_empathy', minLevel: 4 },
    ],
    weaknesses: ['SOCIAL', 'COGNITIVE'],
    battleProtocol: [
      {
        instruction: 'MOVEMENT INTERVENTION: 20 minuti di camminata veloce all\'aperto, attenzione alle sensazioni plantari.',
        durationSeconds: 1200,
        targetEffect: 'Upregulation serotoninergica e BDNF via attività aerobica moderata. Interrupt del DMN loop.',
      },
      {
        instruction: 'GRATITUDE ACTIVATION: Scrivi 3 cose concrete di cui sei grato e spiega PERCHÉ per ciascuna.',
        durationSeconds: 300,
        targetEffect: 'Attivazione del nucleus accumbens e corteccia prefrontale ventromediale via reframing positivo.',
      },
      {
        instruction: 'SOCIAL CONNECTION: Chiama o scrivi a UNA persona cara. Conversazione autentica di almeno 5 minuti.',
        durationSeconds: 300,
        targetEffect: 'Rilascio di ossitocina tramite connessione sociale. Attivazione del vago ventrale (Porges).',
      },
      {
        instruction: 'VALUE RECONNECTION: Scrivi in 60 secondi la risposta a "Per cosa vale la pena lottare?".',
        durationSeconds: 90,
        targetEffect: 'Riattivazione della corteccia prefrontale dorsomediale per generazione di scopo (self-transcendence).',
      },
    ],
    defeatRewards: [
      { skillId: 'soc_vagal_tone', xp: 150 },
      { skillId: 'cog_deep_focus', xp: 100 },
      { skillId: 'soc_cognitive_empathy', xp: 90 },
      { skillId: 'phys_cardio_output', xp: 60 },
    ],
  },
  {
    id: 'PROCRASTINATION_LEECH',
    name: 'Procrastination Leech',
    title: 'La Sanguisuga della Procrastinazione',
    description: 'Parassita che si aggancia al sistema di reward, offrendo gratificazione immediata svuotando quella a lungo termine.',
    neurologicalProfile: 'Ipersensibilità al reward immediato nello striato ventrale con under-activation della corteccia prefrontale dorsolaterale. Deficit di dopamina tonica.',
    maxHP: 130,
    level: 2,
    requirements: [
      { skillId: 'cog_deep_focus', minLevel: 4 },
      { skillId: 'cog_working_memory', minLevel: 3 },
    ],
    weaknesses: ['COGNITIVE', 'PHYSIQUE'],
    battleProtocol: [
      {
        instruction: 'TEMPTATION BUNDLING: Accoppia un compito difficile con un\'attività piacevole (es. podcasts durante esercizio).',
        durationSeconds: 60,
        targetEffect: 'Hack del sistema di reward: associazione pavloviana tra sforzo e piacere.',
      },
      {
        instruction: 'RULE OF TWO MINUTES: Inizia il compito che stai evitando. Solo 2 minuti. Timer attivo.',
        durationSeconds: 120,
        targetEffect: 'Superamento dell\'inerzia iniziale: il costo percepito di iniziazione si azzera una volta in moto (Zeigarnik effect).',
      },
      {
        instruction: 'ENVIRONMENT DESIGN: Rimuovi fisicamente le 3 distrazioni principali dal tuo spazio.',
        durationSeconds: 180,
        targetEffect: 'Riduzione del carico decisionale sulla corteccia prefrontale. Choice architecture.',
      },
      {
        instruction: 'ACCOUNTABILITY BROADCAST: Comunica a qualcuno il tuo obiettivo e la deadline. Ora.',
        durationSeconds: 60,
        targetEffect: 'Attivazione della pressione sociale come commitment device. Corteccia cingolata anteriore.',
      },
    ],
    defeatRewards: [
      { skillId: 'cog_deep_focus', xp: 90 },
      { skillId: 'cog_working_memory', xp: 60 },
      { skillId: 'cog_processing_speed', xp: 40 },
    ],
  },
];
