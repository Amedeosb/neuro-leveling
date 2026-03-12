// ============================================
// NEURO-LEVELING — Core Type Definitions
// ============================================

/** Le 4 macro-categorie neurologiche */
export type SkillCategory = 'PHYSIQUE' | 'NEURAL' | 'COGNITIVE' | 'SOCIAL';

/** Stati emotivi limitanti = Boss */
export type EmotionalBossType =
  | 'ANXIETY_WRAITH'
  | 'LETHARGY_GOLEM'
  | 'ANGER_BERSERKER'
  | 'DESPAIR_PHANTOM'
  | 'PROCRASTINATION_LEECH';

/** Stato di una Quest */
export type QuestStatus = 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'LOCKED';

/** Tipo di Quest */
export type QuestType = 'DAILY' | 'WEEKLY' | 'BOSS' | 'RECOVERY';

/** Stato della battaglia con il Boss */
export type BossFightPhase = 'LOCKED' | 'READY' | 'IN_BATTLE' | 'DEFEATED' | 'RETREATED';

/** Stato del SNA rilevato dall'assessment */
export type ANSState = 'SYMPATHETIC_DOMINANT' | 'BALANCED' | 'PARASYMPATHETIC_DOMINANT';

/** Debuff derivanti dal Daily Assessment */
export interface Debuff {
  id: string;
  name: string;
  description: string;
  affectedCategories: SkillCategory[];
  severityMultiplier: number; // 0.0 - 1.0, riduce XP guadagnati
}

/** Risultato del Daily Assessment "The Awakening" */
export interface DailyAssessment {
  id: string;
  playerId: string;
  date: string; // ISO date
  hrv: number; // ms - Heart Rate Variability
  boltScore: number; // secondi - Body Oxygen Level Test
  moodScore: number; // 1-10
  energyScore: number; // 1-10
  sleepQuality: number; // 1-10
  activeDebuffs: Debuff[];
  ansState: ANSState;
  timestamp: number;
}

/** Parametri per il calcolo XP */
export interface XPGainParams {
  baseXP: number;
  categoryMultiplier: number;
  streakBonus: number;
  debuffPenalty: number;
  difficultyModifier: number;
}
