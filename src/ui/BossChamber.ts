// ============================================
// NEURO-LEVELING — UI: Boss Chamber
// ============================================
import { Boss, BossDefinition, BOSS_DEFINITIONS } from '../models/Boss';
import { Player } from '../models/Player';
import { BossFightPhase, SkillCategory } from '../types';
import { NEURO_THEME } from './Dashboard';

// ========================
// TYPES
// ========================

export interface BossChamberData {
  availableBosses: BossCardData[];
  defeatedBosses: BossCardData[];
  activeBattle: ActiveBattleData | null;
}

export interface BossCardData {
  id: string;
  name: string;
  title: string;
  description: string;
  neurologicalProfile: string;
  level: number;
  maxHP: number;
  weaknesses: SkillCategory[];
  requirements: { skillName: string; currentLevel: number; requiredLevel: number; met: boolean }[];
  isUnlocked: boolean;
  isDefeated: boolean;
  rewardPreview: { skillName: string; xp: number }[];
}

export interface ActiveBattleData {
  bossName: string;
  bossTitle: string;
  currentHP: number;
  maxHP: number;
  hpPercent: number;
  currentStep: number;
  totalSteps: number;
  currentInstruction: string;
  currentDuration: number;
  targetEffect: string;
  phase: BossFightPhase;
  narration: string;
}

// ========================
// BOSS CHAMBER BUILDER
// ========================

export class BossChamber {
  /**
   * Costruisce i dati della Boss Chamber
   */
  static build(player: Player): BossChamberData {
    const availableBosses: BossCardData[] = [];
    const defeatedBosses: BossCardData[] = [];

    for (const bossDef of BOSS_DEFINITIONS) {
      const card = this.buildBossCard(bossDef, player);
      if (player.defeatedBossIds.has(bossDef.id)) {
        defeatedBosses.push({ ...card, isDefeated: true });
      } else {
        availableBosses.push(card);
      }
    }

    // Ordina per livello
    availableBosses.sort((a, b) => a.level - b.level);

    return {
      availableBosses,
      defeatedBosses,
      activeBattle: null,
    };
  }

  /**
   * Inizializza una Boss instance per la battaglia
   */
  static initiateBattle(bossDef: BossDefinition, player: Player): Boss | null {
    const boss = new Boss(bossDef);

    if (!boss.checkRequirements(this.getPlayerSkillLevels(player))) {
      return null;
    }

    boss.phase = 'READY';
    boss.engage();
    return boss;
  }

  /**
   * Costruisce i dati della battaglia attiva
   */
  static buildBattleData(boss: Boss, narration: string = ''): ActiveBattleData {
    const step = boss.battleProtocol[boss.currentProtocolStep] ?? boss.battleProtocol[boss.currentProtocolStep - 1];

    return {
      bossName: boss.name,
      bossTitle: boss.title,
      currentHP: boss.currentHP,
      maxHP: boss.maxHP,
      hpPercent: boss.hpPercent,
      currentStep: boss.currentProtocolStep,
      totalSteps: boss.battleProtocol.length,
      currentInstruction: step?.instruction ?? '',
      currentDuration: step?.durationSeconds ?? 0,
      targetEffect: step?.targetEffect ?? '',
      phase: boss.phase,
      narration,
    };
  }

  private static buildBossCard(bossDef: BossDefinition, player: Player): BossCardData {
    const requirements = bossDef.requirements.map((req) => {
      const skill = player.skills.get(req.skillId);
      return {
        skillName: skill?.name ?? req.skillId,
        currentLevel: skill?.level ?? 0,
        requiredLevel: req.minLevel,
        met: (skill?.level ?? 0) >= req.minLevel,
      };
    });

    const isUnlocked = requirements.every((r) => r.met);

    const rewardPreview = bossDef.defeatRewards.map((r) => {
      const skill = player.skills.get(r.skillId);
      return { skillName: skill?.name ?? r.skillId, xp: r.xp };
    });

    return {
      id: bossDef.id,
      name: bossDef.name,
      title: bossDef.title,
      description: bossDef.description,
      neurologicalProfile: bossDef.neurologicalProfile,
      level: bossDef.level,
      maxHP: bossDef.maxHP,
      weaknesses: bossDef.weaknesses,
      requirements,
      isUnlocked,
      isDefeated: false,
      rewardPreview,
    };
  }

  private static getPlayerSkillLevels(player: Player): Map<string, number> {
    const levels = new Map<string, number>();
    player.skills.forEach((skill, id) => levels.set(id, skill.level));
    return levels;
  }

  /**
   * Render ASCII della Boss Chamber (CLI/debug)
   */
  static renderASCII(data: BossChamberData): string {
    const lines: string[] = [];
    lines.push('╔══════════════════════════════════════════════════╗');
    lines.push('║       B O S S   C H A M B E R                   ║');
    lines.push('║       ⚔  Emotional Overlords  ⚔                ║');
    lines.push('╠══════════════════════════════════════════════════╣');

    for (const boss of data.availableBosses) {
      const lock = boss.isUnlocked ? '⚔' : '🔒';
      lines.push(`║  ${lock} Lv.${boss.level} ${boss.name}`.padEnd(51) + '║');
      lines.push(`║     "${boss.title}"`.padEnd(51) + '║');
      for (const req of boss.requirements) {
        const status = req.met ? '✓' : '✗';
        lines.push(`║     ${status} ${req.skillName}: ${req.currentLevel}/${req.requiredLevel}`.padEnd(51) + '║');
      }
      lines.push('║'.padEnd(51) + '║');
    }

    if (data.defeatedBosses.length > 0) {
      lines.push('╠══════════════════════════════════════════════════╣');
      lines.push('║  ☠ DEFEATED:'.padEnd(51) + '║');
      for (const boss of data.defeatedBosses) {
        lines.push(`║     ☠ ${boss.name} (Lv.${boss.level})`.padEnd(51) + '║');
      }
    }

    lines.push('╚══════════════════════════════════════════════════╝');
    return lines.join('\n');
  }

  /**
   * Render ASCII della battaglia attiva
   */
  static renderBattleASCII(data: ActiveBattleData): string {
    const hpBar = (hp: number, max: number) => {
      const filled = Math.round((hp / max) * 30);
      return '█'.repeat(filled) + '░'.repeat(30 - filled);
    };

    return `
╔══════════════════════════════════════════════════╗
║  ⚔ BOSS FIGHT: ${data.bossName.padEnd(33)}║
║  "${data.bossTitle}"${''.padEnd(Math.max(0, 35 - data.bossTitle.length))}║
╠══════════════════════════════════════════════════╣
║  HP [${hpBar(data.currentHP, data.maxHP)}] ${String(data.currentHP).padStart(3)}/${data.maxHP}║
║  Step: ${data.currentStep}/${data.totalSteps}${''.padEnd(38)}║
╠══════════════════════════════════════════════════╣
║  PROTOCOLLO:                                     ║
║  ${data.currentInstruction.slice(0, 48).padEnd(48)}║
║  Durata: ${data.currentDuration}s${''.padEnd(38)}║
║  Target: ${data.targetEffect.slice(0, 39).padEnd(39)}║
╠══════════════════════════════════════════════════╣
║  SHADOW GUIDE:                                   ║
║  ${(data.narration || '...').slice(0, 48).padEnd(48)}║
╚══════════════════════════════════════════════════╝`;
  }
}
