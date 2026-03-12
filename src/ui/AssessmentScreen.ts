// ============================================
// NEURO-LEVELING — UI: Assessment Screen
// ============================================
import { DailyAssessment, ANSState } from '../types';
import { Player } from '../models/Player';
import { AssessmentEngine, AssessmentInput } from '../services/AssessmentEngine';
import { NEURO_THEME } from './Dashboard';

// ========================
// TYPES
// ========================

export interface AssessmentScreenData {
  /** Form data per l'input */
  form: AssessmentFormData;
  /** Risultato dopo il processo */
  result: AssessmentResultData | null;
  /** Storico per grafico trend */
  history: AssessmentHistoryPoint[];
}

export interface AssessmentFormData {
  hrv: { value: number; min: number; max: number; unit: string; label: string; help: string };
  boltScore: { value: number; min: number; max: number; unit: string; label: string; help: string };
  moodScore: { value: number; min: number; max: number; unit: string; label: string };
  energyScore: { value: number; min: number; max: number; unit: string; label: string };
  sleepQuality: { value: number; min: number; max: number; unit: string; label: string };
}

export interface AssessmentResultData {
  ansState: ANSState;
  ansLabel: string;
  ansColor: string;
  hrvStatus: string;
  boltStatus: string;
  debuffs: { name: string; severity: string; color: string }[];
  isRestDay: boolean;
  comparison: string[];
}

export interface AssessmentHistoryPoint {
  date: string;
  hrv: number;
  boltScore: number;
  moodScore: number;
  energyScore: number;
}

// ========================
// ASSESSMENT SCREEN BUILDER
// ========================

export class AssessmentScreen {
  /**
   * Genera i dati iniziali della schermata Assessment
   */
  static buildForm(): AssessmentFormData {
    return {
      hrv: {
        value: 60,
        min: 10,
        max: 200,
        unit: 'ms',
        label: 'HRV (Heart Rate Variability)',
        help: 'Misurato tramite sensore o app (Oura, Whoop, EliteHRV). Valori più alti = migliore stato parasimpatico.',
      },
      boltScore: {
        value: 20,
        min: 3,
        max: 80,
        unit: 'secondi',
        label: 'BOLT Score (Body Oxygen Level Test)',
        help: 'Espira normalmente, chiudi il naso e misura i secondi fino alla prima urgenza di inspirare. NON trattenere il respiro al massimo.',
      },
      moodScore: {
        value: 5,
        min: 1,
        max: 10,
        unit: '/10',
        label: 'Mood',
      },
      energyScore: {
        value: 5,
        min: 1,
        max: 10,
        unit: '/10',
        label: 'Energy Level',
      },
      sleepQuality: {
        value: 5,
        min: 1,
        max: 10,
        unit: '/10',
        label: 'Qualità del Sonno',
      },
    };
  }

  /**
   * Processa l'input e genera il risultato
   */
  static processAndBuildResult(
    player: Player,
    input: AssessmentInput,
    engine: AssessmentEngine
  ): AssessmentResultData {
    const assessment = engine.processAndApply(player, input);
    const avgHRV = player.getAverageHRV(7);
    const isRestDay = engine.checkOvertraining(player, input.hrv);

    // Confronto con assessment precedente
    const history = player.assessmentHistory;
    const comparison = history.length >= 2
      ? engine.compareAssessments(history[history.length - 2], assessment)
      : ['Prima sessione - baseline in costruzione.'];

    return {
      ansState: assessment.ansState,
      ansLabel: this.getANSLabel(assessment.ansState),
      ansColor: this.getANSColor(assessment.ansState),
      hrvStatus: this.getHRVStatus(input.hrv, avgHRV),
      boltStatus: this.getBOLTStatus(input.boltScore),
      debuffs: assessment.activeDebuffs.map((d) => ({
        name: d.name,
        severity: `${((1 - d.severityMultiplier) * 100).toFixed(0)}% penalità`,
        color: d.severityMultiplier < 0.5 ? NEURO_THEME.colors.accent : NEURO_THEME.colors.warning,
      })),
      isRestDay,
      comparison,
    };
  }

  /**
   * Costruisce lo storico per grafici trend
   */
  static buildHistory(player: Player): AssessmentHistoryPoint[] {
    return player.assessmentHistory.map((a) => ({
      date: a.date,
      hrv: a.hrv,
      boltScore: a.boltScore,
      moodScore: a.moodScore,
      energyScore: a.energyScore,
    }));
  }

  private static getANSLabel(state: ANSState): string {
    switch (state) {
      case 'SYMPATHETIC_DOMINANT': return 'SIMPATICO DOMINANTE';
      case 'BALANCED': return 'EQUILIBRATO';
      case 'PARASYMPATHETIC_DOMINANT': return 'PARASIMPATICO DOMINANTE';
    }
  }

  private static getANSColor(state: ANSState): string {
    switch (state) {
      case 'SYMPATHETIC_DOMINANT': return NEURO_THEME.colors.accent;
      case 'BALANCED': return NEURO_THEME.colors.primary;
      case 'PARASYMPATHETIC_DOMINANT': return NEURO_THEME.colors.success;
    }
  }

  private static getHRVStatus(current: number, average: number): string {
    if (average === 0) return `${current}ms — Baseline in costruzione`;
    const ratio = (current / average * 100).toFixed(0);
    return `${current}ms (${ratio}% della media)`;
  }

  private static getBOLTStatus(boltScore: number): string {
    if (boltScore >= 40) return `${boltScore}s — Eccellente`;
    if (boltScore >= 25) return `${boltScore}s — Buono`;
    if (boltScore >= 15) return `${boltScore}s — Insufficiente`;
    return `${boltScore}s — Critico`;
  }

  /**
   * Render ASCII della schermata Assessment (CLI/debug)
   */
  static renderResultASCII(result: AssessmentResultData): string {
    const lines: string[] = [];
    lines.push('╔══════════════════════════════════════════════════╗');
    lines.push('║    T H E   A W A K E N I N G                    ║');
    lines.push('║    Daily Biometric Assessment                    ║');
    lines.push('╠══════════════════════════════════════════════════╣');
    lines.push(`║  SNA: ${result.ansLabel}`.padEnd(51) + '║');
    lines.push(`║  HRV: ${result.hrvStatus}`.padEnd(51) + '║');
    lines.push(`║  BOLT: ${result.boltStatus}`.padEnd(51) + '║');

    if (result.isRestDay) {
      lines.push('╠══════════════════════════════════════════════════╣');
      lines.push('║  ⚠️  FORCED REST DAY — Sovrallenamento rilevato  ║');
    }

    if (result.debuffs.length > 0) {
      lines.push('╠══════════════════════════════════════════════════╣');
      lines.push('║  DEBUFFS ATTIVI:'.padEnd(51) + '║');
      for (const d of result.debuffs) {
        lines.push(`║    ⊘ ${d.name} (${d.severity})`.padEnd(51) + '║');
      }
    }

    if (result.comparison.length > 0) {
      lines.push('╠══════════════════════════════════════════════════╣');
      lines.push('║  DELTA vs IERI:'.padEnd(51) + '║');
      for (const c of result.comparison) {
        lines.push(`║    ${c.slice(0, 47)}`.padEnd(51) + '║');
      }
    }

    lines.push('╚══════════════════════════════════════════════════╝');
    return lines.join('\n');
  }
}
