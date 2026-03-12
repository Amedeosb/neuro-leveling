// ============================================
// NEURO-LEVELING — Leveling Engine
// Logica completa di calcolo XP e Level-Up
// ============================================
import { SkillCategory, XPGainParams, DailyAssessment } from '../types';
import { Player } from '../models/Player';
import { Skill, xpRequiredForLevel } from '../models/Skill';
import { Quest, QuestDefinition } from '../models/Quest';
import { Boss } from '../models/Boss';

// ========================
// TYPES
// ========================

export interface LevelUpEvent {
  skillId: string;
  skillName: string;
  category: SkillCategory;
  oldLevel: number;
  newLevel: number;
  trigger: 'QUEST' | 'BOSS' | 'BONUS';
  triggerId: string;
  timestamp: number;
}

export interface XPTransaction {
  skillId: string;
  rawXP: number;
  effectiveXP: number;
  streakBonus: number;
  debuffPenalty: number;
  difficultyModifier: number;
  source: 'QUEST' | 'BOSS' | 'BONUS' | 'STREAK';
  sourceId: string;
}

export interface QuestCompletionReport {
  questName: string;
  xpTransactions: XPTransaction[];
  levelUpEvents: LevelUpEvent[];
  totalXPGained: number;
  playerNewTotalLevel: number;
}

export interface BossDefeatReport {
  bossName: string;
  xpTransactions: XPTransaction[];
  levelUpEvents: LevelUpEvent[];
  totalXPGained: number;
}

// ========================
// LEVELING ENGINE
// ========================

export class LevelingEngine {
  /**
   * Calcola l'XP effettivo tenendo conto di tutti i modificatori.
   * 
   * Formula:
   *   effectiveXP = baseXP × difficultyMod × (1 + streakBonus) × (1 - debuffPenalty)
   * 
   * dove:
   *   - difficultyMod = 1 + (questDifficulty - 5) × 0.1  (range: 0.6-1.5)
   *   - streakBonus = min(streak × 0.05, 0.5)  (max +50% a streak 10+)
   *   - debuffPenalty = somma delle penalità dei debuff attivi per la categoria
   */
  static calculateEffectiveXP(
    baseXP: number,
    difficulty: number,
    streak: number,
    debuffPenalty: number
  ): number {
    const difficultyMod = Math.max(0.6, 1 + (difficulty - 5) * 0.1);
    const streakBonus = Math.min(streak * 0.05, 0.5);

    const raw = baseXP * difficultyMod;
    const withStreak = raw * (1 + streakBonus);
    const final = withStreak * (1 - Math.min(debuffPenalty, 0.8)); // Cap debuff al -80%

    return Math.max(1, Math.floor(final));
  }

  /**
   * Processa il completamento di una Quest.
   * Calcola XP, applica modificatori, trigger level-up.
   */
  static processQuestCompletion(player: Player, quest: Quest): QuestCompletionReport {
    const xpTransactions: XPTransaction[] = [];
    const levelUpEvents: LevelUpEvent[] = [];
    let totalXPGained = 0;

    // Completa la quest per ottenere le reward
    const rewards = quest.complete();
    if (rewards.length === 0) {
      return {
        questName: quest.name,
        xpTransactions: [],
        levelUpEvents: [],
        totalXPGained: 0,
        playerNewTotalLevel: player.totalLevel,
      };
    }

    for (const reward of rewards) {
      const skill = player.skills.get(reward.skillId);
      if (!skill) continue;

      // Calcola debuff penalty per la categoria della skill
      const debuffPenalty = player.activeDebuffs
        .filter((d) => d.affectedCategories.includes(skill.category))
        .reduce((sum, d) => sum + (1 - d.severityMultiplier), 0);

      const effectiveXP = this.calculateEffectiveXP(
        reward.xp,
        quest.difficulty,
        player.currentStreak,
        debuffPenalty
      );

      const oldLevel = skill.level;
      const levelsGained = skill.addXP(effectiveXP);

      // Registra transazione
      xpTransactions.push({
        skillId: reward.skillId,
        rawXP: reward.xp,
        effectiveXP,
        streakBonus: Math.min(player.currentStreak * 0.05, 0.5),
        debuffPenalty,
        difficultyModifier: Math.max(0.6, 1 + (quest.difficulty - 5) * 0.1),
        source: 'QUEST',
        sourceId: quest.id,
      });

      totalXPGained += effectiveXP;

      // Registra level-up
      if (levelsGained > 0) {
        levelUpEvents.push({
          skillId: reward.skillId,
          skillName: skill.name,
          category: skill.category,
          oldLevel,
          newLevel: skill.level,
          trigger: 'QUEST',
          triggerId: quest.id,
          timestamp: Date.now(),
        });
      }
    }

    // Aggiorna stato della quest nel player
    player.completedQuestIds.add(quest.definitionId);
    const questIndex = player.activeQuests.findIndex((q) => q.id === quest.id);
    if (questIndex >= 0) player.activeQuests.splice(questIndex, 1);
    player.title = player.dynamicTitle;

    return {
      questName: quest.name,
      xpTransactions,
      levelUpEvents,
      totalXPGained,
      playerNewTotalLevel: player.totalLevel,
    };
  }

  /**
   * Processa la sconfitta di un Boss.
   * I Boss danno XP maggiori e non sono soggetti a debuff penalty.
   */
  static processBossDefeat(player: Player, boss: Boss): BossDefeatReport {
    const xpTransactions: XPTransaction[] = [];
    const levelUpEvents: LevelUpEvent[] = [];
    let totalXPGained = 0;

    if (!boss.isDefeated) {
      return { bossName: boss.name, xpTransactions: [], levelUpEvents: [], totalXPGained: 0 };
    }

    for (const reward of boss.defeatRewards) {
      const skill = player.skills.get(reward.skillId);
      if (!skill) continue;

      // Boss XP hanno bonus del 50% e nessuna debuff penalty
      const bossMultiplier = 1.5;
      const streakBonus = Math.min(player.currentStreak * 0.05, 0.5);
      const effectiveXP = Math.floor(reward.xp * bossMultiplier * (1 + streakBonus));

      const oldLevel = skill.level;
      const levelsGained = skill.addXP(effectiveXP);

      xpTransactions.push({
        skillId: reward.skillId,
        rawXP: reward.xp,
        effectiveXP,
        streakBonus,
        debuffPenalty: 0,
        difficultyModifier: bossMultiplier,
        source: 'BOSS',
        sourceId: boss.id,
      });

      totalXPGained += effectiveXP;

      if (levelsGained > 0) {
        levelUpEvents.push({
          skillId: reward.skillId,
          skillName: skill.name,
          category: skill.category,
          oldLevel,
          newLevel: skill.level,
          trigger: 'BOSS',
          triggerId: boss.id,
          timestamp: Date.now(),
        });
      }
    }

    player.defeatedBossIds.add(boss.id);
    player.title = player.dynamicTitle;

    return {
      bossName: boss.name,
      xpTransactions,
      levelUpEvents,
      totalXPGained,
    };
  }

  /**
   * Calcola il bonus XP giornaliero per lo streak.
   * Ogni 7 giorni consecutivi, il player riceve bonus XP distribuiti equamente.
   */
  static processStreakBonus(player: Player): XPTransaction[] {
    if (player.currentStreak === 0 || player.currentStreak % 7 !== 0) return [];

    const bonusXP = player.currentStreak * 5; // 5 XP per giorno di streak
    const transactions: XPTransaction[] = [];

    // Distribuisci equamente su tutte le skill
    const xpPerSkill = Math.max(1, Math.floor(bonusXP / player.skills.size));

    player.skills.forEach((skill) => {
      skill.addXP(xpPerSkill);
      transactions.push({
        skillId: skill.skillId,
        rawXP: xpPerSkill,
        effectiveXP: xpPerSkill,
        streakBonus: 0,
        debuffPenalty: 0,
        difficultyModifier: 1,
        source: 'STREAK',
        sourceId: `streak_${player.currentStreak}`,
      });
    });

    return transactions;
  }

  /**
   * Mostra una preview dell'XP che si guadagnerebbe completando una quest
   */
  static previewQuestXP(
    player: Player,
    questDef: QuestDefinition
  ): { skillName: string; rawXP: number; effectiveXP: number }[] {
    return questDef.rewards.map((reward) => {
      const skill = player.skills.get(reward.skillId);
      const debuffPenalty = player.activeDebuffs
        .filter((d) => d.affectedCategories.includes(skill?.category ?? 'PHYSIQUE'))
        .reduce((sum, d) => sum + (1 - d.severityMultiplier), 0);

      const effectiveXP = this.calculateEffectiveXP(
        reward.xp,
        questDef.difficulty,
        player.currentStreak,
        debuffPenalty
      );

      return {
        skillName: skill?.name ?? reward.skillId,
        rawXP: reward.xp,
        effectiveXP,
      };
    });
  }

  /**
   * Calcola quante quest servono per raggiungere un certo livello in una skill
   */
  static questsToLevel(
    skill: Skill,
    targetLevel: number,
    avgXPPerQuest: number
  ): number {
    if (skill.level >= targetLevel) return 0;

    const xpNeeded = xpRequiredForLevel(targetLevel) - skill.currentXP;
    return Math.ceil(Math.max(0, xpNeeded) / Math.max(1, avgXPPerQuest));
  }

  /**
   * Genera un summary delle proiezioni di leveling
   */
  static projectionSummary(player: Player): string[] {
    const lines: string[] = [];
    const avgXP = 35; // XP medio per quest reward

    player.skills.forEach((skill) => {
      if (skill.level < 5) {
        const toLevel5 = this.questsToLevel(skill, 5, avgXP);
        lines.push(
          `${skill.name} (Lv.${skill.level}): ~${toLevel5} quest per raggiungere Lv.5`
        );
      }
    });

    return lines;
  }
}
