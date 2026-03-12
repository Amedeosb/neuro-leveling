// ============================================
// NEURO-LEVELING — Assessment Engine
// ============================================
import { DailyAssessment, ANSState, Debuff, SkillCategory } from '../types';
import { Player } from '../models/Player';

// ========================
// INPUT TYPES
// ========================

export interface AssessmentInput {
  hrv: number;          // ms
  boltScore: number;    // secondi
  moodScore: number;    // 1-10
  energyScore: number;  // 1-10
  sleepQuality: number; // 1-10
}

// ========================
// DEBUFF DEFINITIONS
// ========================

const DEBUFF_TEMPLATES: Record<string, Omit<Debuff, 'id'>> = {
  ANXIETY: {
    name: 'Anxiety Signal',
    description: 'Sistema predittivo iperattivo. Segnali di minaccia fantasma dall\'amigdala.',
    affectedCategories: ['COGNITIVE', 'SOCIAL'],
    severityMultiplier: 0.75,
  },
  LETHARGY: {
    name: 'Neural Fog',
    description: 'Down-regulation dopaminergica. Motivazione e velocità di elaborazione compromesse.',
    affectedCategories: ['COGNITIVE', 'PHYSIQUE'],
    severityMultiplier: 0.7,
  },
  SYMPATHETIC_OVERDRIVE: {
    name: 'Fight-or-Flight Lock',
    description: 'SNA bloccato in modalità simpatica. Corteccia prefrontale offline.',
    affectedCategories: ['COGNITIVE', 'SOCIAL'],
    severityMultiplier: 0.6,
  },
  SLEEP_DEBT: {
    name: 'Sleep Debt',
    description: 'Adenosina residua elevata. Consolidamento mnemonico compromesso.',
    affectedCategories: ['COGNITIVE', 'NEURAL', 'PHYSIQUE'],
    severityMultiplier: 0.65,
  },
  RESPIRATORY_DYSFUNCTION: {
    name: 'CO2 Intolerance',
    description: 'Chemocettori ipersensibili. Iperventilazione cronica con alcalosi respiratoria.',
    affectedCategories: ['PHYSIQUE', 'NEURAL'],
    severityMultiplier: 0.8,
  },
  OVERTRAINING: {
    name: 'Allostatic Overload',
    description: 'Carico allostatico critico. Tutti i sistemi in protezione. Solo Recovery autorizzato.',
    affectedCategories: ['PHYSIQUE', 'NEURAL', 'COGNITIVE', 'SOCIAL'],
    severityMultiplier: 0.4,
  },
};

// ========================
// ASSESSMENT ENGINE
// ========================

export class AssessmentEngine {
  /**
   * Processa l'input dell'utente e genera un DailyAssessment completo.
   * include la determinazione dello stato del SNA e dei debuff attivi.
   */
  processAssessment(playerId: string, input: AssessmentInput): DailyAssessment {
    const ansState = this.determineANSState(input);
    const activeDebuffs = this.detectDebuffs(input, ansState);

    const assessment: DailyAssessment = {
      id: `assess_${playerId}_${Date.now()}`,
      playerId,
      date: new Date().toISOString().split('T')[0],
      hrv: input.hrv,
      boltScore: input.boltScore,
      moodScore: input.moodScore,
      energyScore: input.energyScore,
      sleepQuality: input.sleepQuality,
      activeDebuffs,
      ansState,
      timestamp: Date.now(),
    };

    return assessment;
  }

  /**
   * Processa l'assessment E lo applica al player
   */
  processAndApply(player: Player, input: AssessmentInput): DailyAssessment {
    const assessment = this.processAssessment(player.id, input);
    player.recordAssessment(assessment);
    return assessment;
  }

  /**
   * Determina lo stato del Sistema Nervoso Autonomo basandosi su HRV e altri indicatori.
   * 
   * Logica:
   * - HRV alto + mood alto → Parasimpatico (recupero/relax)
   * - HRV medio + energy medio → Bilanciato
   * - HRV basso + energy alto → Simpatico (fight-or-flight)
   * - HRV basso + mood basso → Simpatico (stress cronico)
   */
  private determineANSState(input: AssessmentInput): ANSState {
    // Score composito ponderato per determinare il bias del SNA
    // HRV è l'indicatore primario (peso 40%), gli altri contribuiscono
    const hrvNorm = Math.min(input.hrv / 100, 1.5); // Normalizzato: ≥100ms = ottimo
    const moodNorm = input.moodScore / 10;
    const energyNorm = input.energyScore / 10;
    const sleepNorm = input.sleepQuality / 10;
    const boltNorm = Math.min(input.boltScore / 40, 1.0); // ≥40s = ottimo

    // Composite parasympathetic index (0-1)
    const parasympatheticIndex =
      hrvNorm * 0.4 +
      moodNorm * 0.15 +
      sleepNorm * 0.2 +
      boltNorm * 0.15 +
      (1 - energyNorm) * 0.1; // Energia troppo alta può indicare simpatico

    if (parasympatheticIndex >= 0.7) return 'PARASYMPATHETIC_DOMINANT';
    if (parasympatheticIndex >= 0.4) return 'BALANCED';
    return 'SYMPATHETIC_DOMINANT';
  }

  /**
   * Rileva i debuff attivi basandosi sui biomarcatori
   */
  private detectDebuffs(input: AssessmentInput, ansState: ANSState): Debuff[] {
    const debuffs: Debuff[] = [];

    // ---- ANXIETY ----
    // HRV basso + mood basso + simpatico
    if (input.hrv < 50 && input.moodScore <= 4 && ansState === 'SYMPATHETIC_DOMINANT') {
      debuffs.push({ id: `debuff_anxiety_${Date.now()}`, ...DEBUFF_TEMPLATES.ANXIETY });
    }

    // ---- LETHARGY ----
    // Energy molto basso + mood medio-basso
    if (input.energyScore <= 3 && input.moodScore <= 5) {
      debuffs.push({ id: `debuff_lethargy_${Date.now()}`, ...DEBUFF_TEMPLATES.LETHARGY });
    }

    // ---- SYMPATHETIC OVERDRIVE ----
    if (ansState === 'SYMPATHETIC_DOMINANT' && input.hrv < 40) {
      debuffs.push({ id: `debuff_sympathetic_${Date.now()}`, ...DEBUFF_TEMPLATES.SYMPATHETIC_OVERDRIVE });
    }

    // ---- SLEEP DEBT ----
    if (input.sleepQuality <= 3) {
      debuffs.push({ id: `debuff_sleep_${Date.now()}`, ...DEBUFF_TEMPLATES.SLEEP_DEBT });
    }

    // ---- RESPIRATORY DYSFUNCTION ----
    if (input.boltScore < 15) {
      debuffs.push({ id: `debuff_respiratory_${Date.now()}`, ...DEBUFF_TEMPLATES.RESPIRATORY_DYSFUNCTION });
    }

    return debuffs;
  }

  /**
   * Verifica se il player è in sovrallenamento confrontando HRV corrente con la media
   */
  checkOvertraining(player: Player, currentHRV: number): boolean {
    const avgHRV = player.getAverageHRV(7);
    if (avgHRV === 0) return false;
    return currentHRV < avgHRV * 0.7;
  }

  /**
   * Genera un report comparativo tra due assessment
   */
  compareAssessments(previous: DailyAssessment, current: DailyAssessment): string[] {
    const changes: string[] = [];

    const hrvDelta = current.hrv - previous.hrv;
    if (Math.abs(hrvDelta) > 5) {
      changes.push(`HRV: ${hrvDelta > 0 ? '+' : ''}${hrvDelta.toFixed(0)}ms (${hrvDelta > 0 ? '↑ Recupero parasimpatico' : '↓ Carico allostatico in aumento'})`);
    }

    const boltDelta = current.boltScore - previous.boltScore;
    if (Math.abs(boltDelta) > 3) {
      changes.push(`BOLT: ${boltDelta > 0 ? '+' : ''}${boltDelta.toFixed(0)}s (${boltDelta > 0 ? '↑ Tolleranza CO2 migliorata' : '↓ Regressione respiratoria'})`);
    }

    if (current.ansState !== previous.ansState) {
      changes.push(`SNA: ${previous.ansState} → ${current.ansState}`);
    }

    const debuffDelta = current.activeDebuffs.length - previous.activeDebuffs.length;
    if (debuffDelta !== 0) {
      changes.push(`Debuffs: ${debuffDelta > 0 ? '+' : ''}${debuffDelta} (${current.activeDebuffs.length} attivi)`);
    }

    return changes;
  }
}
