// ============================================
// NEURO-LEVELING — Quest Model
// ============================================
import { SkillCategory, QuestStatus, QuestType, XPGainParams } from '../types';

export interface QuestRequirement {
  skillId: string;
  minLevel: number;
}

export interface QuestReward {
  skillId: string;
  xp: number;
}

export interface QuestDefinition {
  id: string;
  name: string;
  description: string;
  scientificRationale: string;
  type: QuestType;
  category: SkillCategory;
  difficulty: number; // 1-10
  durationMinutes: number;
  requirements: QuestRequirement[];
  rewards: QuestReward[];
  protocol: string[]; // Passi del protocollo da seguire
}

export class Quest {
  id: string;
  definitionId: string;
  name: string;
  description: string;
  scientificRationale: string;
  type: QuestType;
  category: SkillCategory;
  difficulty: number;
  durationMinutes: number;
  requirements: QuestRequirement[];
  rewards: QuestReward[];
  protocol: string[];
  status: QuestStatus;
  assignedDate: string;
  completedDate?: string;
  startedAt?: number;

  constructor(definition: QuestDefinition, assignedDate: string) {
    this.id = `quest_${definition.id}_${assignedDate}`;
    this.definitionId = definition.id;
    this.name = definition.name;
    this.description = definition.description;
    this.scientificRationale = definition.scientificRationale;
    this.type = definition.type;
    this.category = definition.category;
    this.difficulty = definition.difficulty;
    this.durationMinutes = definition.durationMinutes;
    this.requirements = definition.requirements;
    this.rewards = definition.rewards;
    this.protocol = definition.protocol;
    this.status = 'AVAILABLE';
    this.assignedDate = assignedDate;
  }

  start(): void {
    if (this.status !== 'AVAILABLE') return;
    this.status = 'IN_PROGRESS';
    this.startedAt = Date.now();
  }

  complete(): QuestReward[] {
    if (this.status !== 'IN_PROGRESS') return [];
    this.status = 'COMPLETED';
    this.completedDate = new Date().toISOString().split('T')[0];
    return this.rewards;
  }

  fail(): void {
    if (this.status !== 'IN_PROGRESS') return;
    this.status = 'FAILED';
  }

  /**
   * Calcola XP effettivi con modificatori
   */
  calculateEffectiveXP(params: XPGainParams): number {
    const raw = params.baseXP * params.categoryMultiplier * params.difficultyModifier;
    const withStreak = raw * (1 + params.streakBonus);
    const withDebuff = withStreak * (1 - Math.min(params.debuffPenalty, 0.8));
    return Math.max(1, Math.floor(withDebuff));
  }
}

// ============================================
// Definizioni Predefinite delle Quest
// ============================================

export const QUEST_DEFINITIONS: QuestDefinition[] = [
  // ---- RECOVERY / PARASYMPATHETIC ----
  {
    id: 'vagal_reset',
    name: 'Vagal Reset',
    description: 'Ripristina l\'equilibrio del SNA tramite stimolazione vagale.',
    scientificRationale: 'La stimolazione del nervo vago attiva il sistema parasimpatico, riducendo cortisolo e norepinefrina.',
    type: 'RECOVERY',
    category: 'SOCIAL',
    difficulty: 2,
    durationMinutes: 10,
    requirements: [],
    rewards: [
      { skillId: 'soc_vagal_tone', xp: 30 },
      { skillId: 'soc_cardiac_coherence', xp: 20 },
    ],
    protocol: [
      'Posizione supina, gambe elevate a 90°',
      'Respirazione diaframmatica: 4s inspirazione, 8s espirazione',
      'Massaggio del seno carotideo (leggero, bilaterale, 30s)',
      'Gargarismo con acqua fredda per 30s (stimolazione vagale)',
      'Cold exposure: immersione del viso in acqua fredda 10-15°C per 30s',
    ],
  },
  {
    id: 'box_breathing',
    name: 'Box Breathing Protocol',
    description: 'Protocollo di respirazione quadrata per stabilizzazione del SNA.',
    scientificRationale: 'Il pattern 4-4-4-4 equalizza il rapporto simpatico/parasimpatico indotto dalla coerenza cardiaca respiratoria.',
    type: 'DAILY',
    category: 'SOCIAL',
    difficulty: 3,
    durationMinutes: 8,
    requirements: [],
    rewards: [
      { skillId: 'soc_cardiac_coherence', xp: 25 },
      { skillId: 'phys_co2_tolerance', xp: 15 },
    ],
    protocol: [
      'Posizione seduta eretta, spalle rilassate',
      'Inspirare per 4 secondi (nasale)',
      'Trattenere il respiro per 4 secondi',
      'Espirare per 4 secondi (nasale)',
      'Trattenere il respiro per 4 secondi',
      'Ripetere per 5 minuti (8 cicli minimo)',
    ],
  },
  {
    id: 'deep_work_session',
    name: 'Deep Work Dungeon',
    description: 'Sessione di lavoro profondo con eliminazione di distrazioni.',
    scientificRationale: 'Il deep work attiva la corteccia prefrontale dorsolaterale e induce uno stato di flow dopaminergico.',
    type: 'DAILY',
    category: 'COGNITIVE',
    difficulty: 7,
    durationMinutes: 90,
    requirements: [
      { skillId: 'cog_deep_focus', minLevel: 3 },
    ],
    rewards: [
      { skillId: 'cog_deep_focus', xp: 60 },
      { skillId: 'cog_working_memory', xp: 30 },
      { skillId: 'cog_processing_speed', xp: 20 },
    ],
    protocol: [
      'Disattiva TUTTE le notifiche (telefono in modalità aereo)',
      'Definisci un singolo obiettivo misurabile per la sessione',
      'Timer Pomodoro: 90 minuti senza interruzioni',
      'Se la mente divaga, appunta il pensiero e ritorna al focus',
      'Al termine: 10 minuti di riposo attivo (camminata)',
    ],
  },
  {
    id: 'cold_exposure',
    name: 'Protocollo Cold Exposure',
    description: 'Esposizione controllata al freddo per resilienza neurochimica.',
    scientificRationale: 'Il cold stress aumenta norepinefrina del 200-300% e attiva il tessuto adiposo bruno.',
    type: 'DAILY',
    category: 'PHYSIQUE',
    difficulty: 6,
    durationMinutes: 15,
    requirements: [
      { skillId: 'soc_vagal_tone', minLevel: 2 },
    ],
    rewards: [
      { skillId: 'phys_co2_tolerance', xp: 40 },
      { skillId: 'soc_vagal_tone', xp: 25 },
      { skillId: 'neural_pain_modulation', xp: 35 },
    ],
    protocol: [
      'Inizia con 30s di respirazione controllata',
      'Doccia fredda: inizia con 30s e aumenta progressivamente',
      'Mantieni la respirazione nasale e controllata',
      'NON iperventilare — controllo volontario del brivido',
      'Terminare con asciugatura e 2 minuti di respirazione normale',
    ],
  },
  {
    id: 'vestibular_training',
    name: 'Vestibular Calibration',
    description: 'Allenamento del sistema vestibolare per equilibrio e orientamento.',
    scientificRationale: 'La stimolazione vestibolare migliora la connettività cerebellare e riduce la cinetosi.',
    type: 'DAILY',
    category: 'NEURAL',
    difficulty: 4,
    durationMinutes: 15,
    requirements: [],
    rewards: [
      { skillId: 'neural_vestibular', xp: 40 },
      { skillId: 'neural_proprioception', xp: 25 },
    ],
    protocol: [
      'Stazione eretta su una gamba, occhi chiusi — 30s per lato',
      'Rotazioni della testa lente (VOR cancellation) — 10 ripetizioni',
      'Camminata su linea retta con rotazione della testa — 3 tratti',
      'Posizione tandem (piedi in fila) con perturbazioni — 60s',
    ],
  },
  {
    id: 'strength_session',
    name: 'Protocollo Forza Neurale',
    description: 'Allenamento di forza massimale con focus sul reclutamento neurale.',
    scientificRationale: 'Il carico sub-massimale (85%+ 1RM) migliora il rate coding e la sincronizzazione delle unità motorie.',
    type: 'DAILY',
    category: 'PHYSIQUE',
    difficulty: 8,
    durationMinutes: 45,
    requirements: [
      { skillId: 'phys_max_strength', minLevel: 2 },
      { skillId: 'phys_mobility', minLevel: 2 },
    ],
    rewards: [
      { skillId: 'phys_max_strength', xp: 55 },
      { skillId: 'phys_mobility', xp: 15 },
    ],
    protocol: [
      'Warm-up: 5 min di mobilità articolare dinamica',
      'Attivazione neurale: 3x3 salti con atterraggio controllato',
      'Esercizio principale: 5x3 al 85% 1RM (riposo 3-5 min)',
      'Accessorio: 3x8 a intensità moderata',
      'Cool-down: respirazione diaframmatica 3 min',
    ],
  },
];
