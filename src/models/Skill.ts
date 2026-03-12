// ============================================
// NEURO-LEVELING — Skill Model
// ============================================
import { SkillCategory } from '../types';

/** XP richiesti per salire di livello (curva esponenziale) */
export function xpRequiredForLevel(level: number): number {
  // Formula: 100 * level^1.5 — curva bilanciata
  return Math.floor(100 * Math.pow(level, 1.5));
}

export interface SkillDefinition {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  neurologicalBasis: string; // Razionale scientifico
  maxLevel: number;
}

export interface PlayerSkill {
  skillId: string;
  category: SkillCategory;
  name: string;
  level: number;
  currentXP: number;
  totalXPEarned: number;

  /** Calcola se si è pronti per il level up */
  readonly xpToNextLevel: number;
  readonly isMaxLevel: boolean;
  readonly progressPercent: number;
}

export class Skill implements PlayerSkill {
  skillId: string;
  category: SkillCategory;
  name: string;
  level: number;
  currentXP: number;
  totalXPEarned: number;
  maxLevel: number;

  constructor(definition: SkillDefinition, level = 1, currentXP = 0, totalXPEarned = 0) {
    this.skillId = definition.id;
    this.category = definition.category;
    this.name = definition.name;
    this.level = level;
    this.currentXP = currentXP;
    this.totalXPEarned = totalXPEarned;
    this.maxLevel = definition.maxLevel;
  }

  get xpToNextLevel(): number {
    return xpRequiredForLevel(this.level + 1) - this.currentXP;
  }

  get isMaxLevel(): boolean {
    return this.level >= this.maxLevel;
  }

  get progressPercent(): number {
    if (this.isMaxLevel) return 100;
    const required = xpRequiredForLevel(this.level + 1);
    const prevRequired = xpRequiredForLevel(this.level);
    const levelXP = required - prevRequired;
    const currentLevelXP = this.currentXP - prevRequired;
    return Math.min(100, Math.max(0, (currentLevelXP / levelXP) * 100));
  }

  /**
   * Aggiunge XP alla skill e gestisce il level-up.
   * Restituisce il numero di livelli guadagnati.
   */
  addXP(amount: number): number {
    if (this.isMaxLevel || amount <= 0) return 0;

    this.currentXP += amount;
    this.totalXPEarned += amount;

    let levelsGained = 0;
    while (!this.isMaxLevel && this.currentXP >= xpRequiredForLevel(this.level + 1)) {
      this.level++;
      levelsGained++;
    }

    if (this.isMaxLevel) {
      this.currentXP = xpRequiredForLevel(this.maxLevel);
    }

    return levelsGained;
  }
}

// ============================================
// Definizioni Predefinite delle Skill
// ============================================

export const SKILL_DEFINITIONS: SkillDefinition[] = [
  // ---- PHYSIQUE ----
  {
    id: 'phys_max_strength',
    name: 'Forza Massimale',
    category: 'PHYSIQUE',
    description: 'Output di forza muscolare controlata sotto sforzo.',
    neurologicalBasis: 'Reclutamento delle unità motorie e inibizione degli organi tendinei del Golgi.',
    maxLevel: 50,
  },
  {
    id: 'phys_co2_tolerance',
    name: 'Tolleranza CO2',
    category: 'PHYSIQUE',
    description: 'Capacità di tollerare alti livelli di CO2 senza panico respiratorio.',
    neurologicalBasis: 'Desensibilizzazione dei chemocettori centrali nel tronco encefalico.',
    maxLevel: 50,
  },
  {
    id: 'phys_mobility',
    name: 'Mobilità Articolare',
    category: 'PHYSIQUE',
    description: 'Range of motion attivo sotto controllo neuromuscolare.',
    neurologicalBasis: 'Rilascio della co-contrazione agonista-antagonista via interneuroni spinali.',
    maxLevel: 50,
  },
  {
    id: 'phys_cardio_output',
    name: 'Output Cardiovascolare',
    category: 'PHYSIQUE',
    description: 'Efficienza del sistema aerobico sotto carico crescente.',
    neurologicalBasis: 'Adattamento della gittata cardiaca e del VO2max per neuroplasticità autonomica.',
    maxLevel: 50,
  },

  // ---- NEURAL ----
  {
    id: 'neural_visual_acuity',
    name: 'Acuità Visiva',
    category: 'NEURAL',
    description: 'Precisione e velocità del sistema visivo.',
    neurologicalBasis: 'Calibrazione dei muscoli extraoculari e integrazione nella corteccia visiva V1-V4.',
    maxLevel: 50,
  },
  {
    id: 'neural_vestibular',
    name: 'Equilibrio Vestibolare',
    category: 'NEURAL',
    description: 'Stabilità posturale in condizioni dinamiche.',
    neurologicalBasis: 'Integrazione dei canali semicircolari con il sistema propriocettivo.',
    maxLevel: 50,
  },
  {
    id: 'neural_proprioception',
    name: 'Propriocezione',
    category: 'NEURAL',
    description: 'Consapevolezza della posizione del corpo nello spazio.',
    neurologicalBasis: 'Elaborazione dei fusi neuromuscolari e della corteccia somatosensoriale S1.',
    maxLevel: 50,
  },
  {
    id: 'neural_pain_modulation',
    name: 'Modulazione del Dolore',
    category: 'NEURAL',
    description: 'Capacità di down-regolare i segnali nocicettivi.',
    neurologicalBasis: 'Attivazione del sistema discendente di inibizione del dolore (PAG e RVM).',
    maxLevel: 50,
  },

  // ---- COGNITIVE ----
  {
    id: 'cog_deep_focus',
    name: 'Focus Profondo',
    category: 'COGNITIVE',
    description: 'Capacità di mantenere l\'attenzione sostenuta per periodi prolungati.',
    neurologicalBasis: 'Modulazione dopaminergica e noradrenergica nella corteccia prefrontale dorsolaterale.',
    maxLevel: 50,
  },
  {
    id: 'cog_working_memory',
    name: 'Memoria di Lavoro',
    category: 'COGNITIVE',
    description: 'Capacità di manipolare informazioni in tempo reale.',
    neurologicalBasis: 'Loop fonologico e taccuino visuospaziale nel modello di Baddeley.',
    maxLevel: 50,
  },
  {
    id: 'cog_processing_speed',
    name: 'Velocità di Elaborazione',
    category: 'COGNITIVE',
    description: 'Rapidità nel processare input e generare output cognitivi.',
    neurologicalBasis: 'Mielinizzazione e velocità di conduzione nelle fibre bianche corticali.',
    maxLevel: 50,
  },
  {
    id: 'cog_creativity',
    name: 'Pensiero Divergente',
    category: 'COGNITIVE',
    description: 'Capacità di generare soluzioni originali e connessioni non lineari.',
    neurologicalBasis: 'Attivazione del Default Mode Network in alternanza con la rete di salienza.',
    maxLevel: 50,
  },

  // ---- SOCIAL ----
  {
    id: 'soc_vagal_tone',
    name: 'Tono Vagale',
    category: 'SOCIAL',
    description: 'Capacità del nervo vago di modulare il ritmo cardiaco e lo stato emotivo.',
    neurologicalBasis: 'Teoria Polivagale di Porges: attivazione del vago ventrale (smart vagus).',
    maxLevel: 50,
  },
  {
    id: 'soc_cardiac_coherence',
    name: 'Coerenza Cardiaca',
    category: 'SOCIAL',
    description: 'Sincronizzazione ritmica tra cuore, respiro e pressione arteriosa.',
    neurologicalBasis: 'Risonanza barorecettoriale a ~0.1 Hz per massima variabilità cardiaca.',
    maxLevel: 50,
  },
  {
    id: 'soc_cognitive_empathy',
    name: 'Empatia Cognitiva',
    category: 'SOCIAL',
    description: 'Capacità di modellare lo stato mentale altrui senza contagio emotivo.',
    neurologicalBasis: 'Attivazione della giunzione temporoparietale e corteccia prefrontale mediale.',
    maxLevel: 50,
  },
  {
    id: 'soc_leadership',
    name: 'Leadership',
    category: 'SOCIAL',
    description: 'Capacità di influenzare e dirigere gruppi sociali in modo efficace.',
    neurologicalBasis: 'Integrazione di tono vagale, empatia cognitiva e regolazione del SNA.',
    maxLevel: 50,
  },
];
