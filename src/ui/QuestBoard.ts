// ============================================
// NEURO-LEVELING — UI: Quest Board
// ============================================
import { Quest, QuestDefinition, QUEST_DEFINITIONS } from '../models/Quest';
import { Player } from '../models/Player';
import { QuestStatus, SkillCategory } from '../types';
import { NEURO_THEME } from './Dashboard';

// ========================
// TYPES
// ========================

export interface QuestBoardData {
  availableQuests: QuestCardData[];
  activeQuests: QuestCardData[];
  completedToday: QuestCardData[];
  dailyProgress: DailyProgressData;
}

export interface QuestCardData {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  difficulty: number;
  durationMinutes: number;
  status: QuestStatus;
  rewards: { skillName: string; xp: number }[];
  protocol: string[];
  isLocked: boolean;
  lockReason?: string;
  categoryColor: string;
  difficultyLabel: string;
}

export interface DailyProgressData {
  questsCompleted: number;
  questsTotal: number;
  xpEarnedToday: number;
  progressPercent: number;
}

// ========================
// QUEST BOARD BUILDER
// ========================

export class QuestBoard {
  /**
   * Costruisce i dati della Quest Board basandosi sullo stato del player
   * e sulle quest disponibili/assegnate.
   */
  static build(player: Player, suggestedQuests: QuestDefinition[]): QuestBoardData {
    const availableQuests: QuestCardData[] = [];
    const activeQuests: QuestCardData[] = [];
    const completedToday: QuestCardData[] = [];

    // Quest attive del player
    for (const quest of player.activeQuests) {
      const card = this.buildQuestCard(quest, player);
      if (quest.status === 'COMPLETED') {
        completedToday.push(card);
      } else if (quest.status === 'IN_PROGRESS') {
        activeQuests.push(card);
      } else {
        availableQuests.push(card);
      }
    }

    // Quest suggerite non ancora assegnate
    for (const questDef of suggestedQuests) {
      const alreadyAssigned = player.activeQuests.some((q) => q.definitionId === questDef.id);
      if (alreadyAssigned) continue;

      const card = this.buildQuestCardFromDefinition(questDef, player);
      availableQuests.push(card);
    }

    return {
      availableQuests,
      activeQuests,
      completedToday,
      dailyProgress: {
        questsCompleted: completedToday.length,
        questsTotal: availableQuests.length + activeQuests.length + completedToday.length,
        xpEarnedToday: 0, // Calcolato dal LevelingEngine
        progressPercent: completedToday.length > 0
          ? (completedToday.length / (availableQuests.length + activeQuests.length + completedToday.length)) * 100
          : 0,
      },
    };
  }

  private static buildQuestCard(quest: Quest, player: Player): QuestCardData {
    const { isLocked, lockReason } = this.checkQuestAccess(quest, player);

    return {
      id: quest.id,
      name: quest.name,
      description: quest.description,
      category: quest.category,
      difficulty: quest.difficulty,
      durationMinutes: quest.durationMinutes,
      status: isLocked ? 'LOCKED' : quest.status,
      rewards: quest.rewards.map((r) => {
        const skill = player.skills.get(r.skillId);
        return { skillName: skill?.name ?? r.skillId, xp: r.xp };
      }),
      protocol: quest.protocol,
      isLocked,
      lockReason,
      categoryColor: this.getCategoryColor(quest.category),
      difficultyLabel: this.getDifficultyLabel(quest.difficulty),
    };
  }

  private static buildQuestCardFromDefinition(
    questDef: QuestDefinition,
    player: Player
  ): QuestCardData {
    const meetsRequirements = questDef.requirements.every((req) => {
      const skill = player.skills.get(req.skillId);
      return skill && skill.level >= req.minLevel;
    });

    let lockReason: string | undefined;
    if (!meetsRequirements) {
      const missing = questDef.requirements
        .filter((req) => {
          const skill = player.skills.get(req.skillId);
          return !skill || skill.level < req.minLevel;
        })
        .map((req) => {
          const skill = player.skills.get(req.skillId);
          return `${skill?.name ?? req.skillId} Lv.${skill?.level ?? 0}/${req.minLevel}`;
        });
      lockReason = `Requisiti mancanti: ${missing.join(', ')}`;
    }

    return {
      id: questDef.id,
      name: questDef.name,
      description: questDef.description,
      category: questDef.category,
      difficulty: questDef.difficulty,
      durationMinutes: questDef.durationMinutes,
      status: meetsRequirements ? 'AVAILABLE' : 'LOCKED',
      rewards: questDef.rewards.map((r) => {
        const skill = player.skills.get(r.skillId);
        return { skillName: skill?.name ?? r.skillId, xp: r.xp };
      }),
      protocol: questDef.protocol,
      isLocked: !meetsRequirements,
      lockReason,
      categoryColor: this.getCategoryColor(questDef.category),
      difficultyLabel: this.getDifficultyLabel(questDef.difficulty),
    };
  }

  private static checkQuestAccess(quest: Quest, player: Player): { isLocked: boolean; lockReason?: string } {
    const unmet = quest.requirements.filter((req) => {
      const skill = player.skills.get(req.skillId);
      return !skill || skill.level < req.minLevel;
    });

    if (unmet.length > 0) {
      return {
        isLocked: true,
        lockReason: `Skill insufficienti: ${unmet.map((r) => r.skillId).join(', ')}`,
      };
    }
    return { isLocked: false };
  }

  private static getCategoryColor(category: SkillCategory): string {
    const map: Record<SkillCategory, string> = {
      PHYSIQUE: NEURO_THEME.colors.physique,
      NEURAL: NEURO_THEME.colors.neural,
      COGNITIVE: NEURO_THEME.colors.cognitive,
      SOCIAL: NEURO_THEME.colors.social,
    };
    return map[category];
  }

  private static getDifficultyLabel(difficulty: number): string {
    if (difficulty <= 2) return 'E-Rank';
    if (difficulty <= 4) return 'D-Rank';
    if (difficulty <= 5) return 'C-Rank';
    if (difficulty <= 7) return 'B-Rank';
    if (difficulty <= 8) return 'A-Rank';
    return 'S-Rank';
  }

  /**
   * Render ASCII della quest board (CLI/debug)
   */
  static renderASCII(data: QuestBoardData): string {
    const lines: string[] = [];
    lines.push('╔══════════════════════════════════════════════════╗');
    lines.push('║          Q U E S T   B O A R D                  ║');
    lines.push(`║  Progress: ${data.dailyProgress.questsCompleted}/${data.dailyProgress.questsTotal} quests | ${data.dailyProgress.progressPercent.toFixed(0)}%`.padEnd(51) + '║');
    lines.push('╠══════════════════════════════════════════════════╣');

    if (data.activeQuests.length > 0) {
      lines.push('║  ► ACTIVE:'.padEnd(51) + '║');
      for (const q of data.activeQuests) {
        lines.push(`║    [${q.category.slice(0, 3)}] ${q.name} (${q.difficultyLabel})`.padEnd(51) + '║');
      }
    }

    if (data.availableQuests.length > 0) {
      lines.push('║  ○ AVAILABLE:'.padEnd(51) + '║');
      for (const q of data.availableQuests) {
        const lock = q.isLocked ? ' 🔒' : '';
        lines.push(`║    [${q.category.slice(0, 3)}] ${q.name}${lock}`.padEnd(51) + '║');
      }
    }

    if (data.completedToday.length > 0) {
      lines.push('║  ✓ COMPLETED:'.padEnd(51) + '║');
      for (const q of data.completedToday) {
        lines.push(`║    [${q.category.slice(0, 3)}] ${q.name} ✓`.padEnd(51) + '║');
      }
    }

    lines.push('╚══════════════════════════════════════════════════╝');
    return lines.join('\n');
  }
}
