// ============================================
// NEURO-LEVELING — Player Model
// ============================================
import { SkillCategory, DailyAssessment, Debuff } from '../types';
import { Skill, SKILL_DEFINITIONS, xpRequiredForLevel } from './Skill';
import { Quest } from './Quest';
import { Boss } from './Boss';

export interface PlayerStats {
  totalLevel: number;
  categoryLevels: Record<SkillCategory, number>;
  totalXP: number;
  questsCompleted: number;
  bossesDefeated: number;
  currentStreak: number;
  longestStreak: number;
}

export interface PlayerData {
  id: string;
  name: string;
  title: string;
  createdAt: string;
  lastLoginDate: string;
  skills: Skill[];
  activeQuests: Quest[];
  completedQuestIds: string[];
  defeatedBossIds: string[];
  assessmentHistory: DailyAssessment[];
  activeDebuffs: Debuff[];
  currentStreak: number;
  longestStreak: number;
}

export class Player {
  id: string;
  name: string;
  title: string;
  createdAt: string;
  lastLoginDate: string;
  skills: Map<string, Skill>;
  activeQuests: Quest[];
  completedQuestIds: Set<string>;
  defeatedBossIds: Set<string>;
  assessmentHistory: DailyAssessment[];
  activeDebuffs: Debuff[];
  currentStreak: number;
  longestStreak: number;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
    this.title = 'Neophyte';
    this.createdAt = new Date().toISOString();
    this.lastLoginDate = new Date().toISOString().split('T')[0];
    this.skills = new Map();
    this.activeQuests = [];
    this.completedQuestIds = new Set();
    this.defeatedBossIds = new Set();
    this.assessmentHistory = [];
    this.activeDebuffs = [];
    this.currentStreak = 0;
    this.longestStreak = 0;

    // Inizializza tutte le skill al livello 1
    for (const def of SKILL_DEFINITIONS) {
      this.skills.set(def.id, new Skill(def));
    }
  }

  // ========================
  // LEVELING SYSTEM
  // ========================

  /** Livello totale = media dei livelli di tutte le skill */
  get totalLevel(): number {
    let sum = 0;
    this.skills.forEach((skill) => (sum += skill.level));
    return Math.floor(sum / this.skills.size);
  }

  /** Livello per categoria = media dei livelli delle skill nella categoria */
  getCategoryLevel(category: SkillCategory): number {
    let sum = 0;
    let count = 0;
    this.skills.forEach((skill) => {
      if (skill.category === category) {
        sum += skill.level;
        count++;
      }
    });
    return count > 0 ? Math.floor(sum / count) : 0;
  }

  /** Titolo basato sul livello totale */
  get dynamicTitle(): string {
    const level = this.totalLevel;
    if (level < 5) return 'Neophyte';
    if (level < 10) return 'Initiate';
    if (level < 15) return 'Adept';
    if (level < 20) return 'Specialist';
    if (level < 25) return 'Expert';
    if (level < 30) return 'Master';
    if (level < 35) return 'Grand Master';
    if (level < 40) return 'Ascendant';
    if (level < 45) return 'Transcendent';
    return 'Shadow Monarch';
  }

  // ========================
  // QUEST SYSTEM
  // ========================

  /**
   * Completa una quest e distribuisce XP alle skill corrispondenti.
   * Restituisce un report dei livelli guadagnati.
   */
  completeQuest(questId: string): Map<string, number> | null {
    const questIndex = this.activeQuests.findIndex((q) => q.id === questId);
    if (questIndex === -1) return null;

    const quest = this.activeQuests[questIndex];
    const rewards = quest.complete();
    if (rewards.length === 0) return null;

    const levelUps = new Map<string, number>();

    for (const reward of rewards) {
      const skill = this.skills.get(reward.skillId);
      if (!skill) continue;

      // Calcola XP effettivo con modificatori
      const debuffPenalty = this.calculateDebuffPenalty(skill.category);
      const streakBonus = Math.min(this.currentStreak * 0.05, 0.5); // max +50%
      const difficultyMod = 1 + (quest.difficulty - 5) * 0.1; // difficulty 5 = base

      const effectiveXP = quest.calculateEffectiveXP({
        baseXP: reward.xp,
        categoryMultiplier: 1.0,
        streakBonus,
        debuffPenalty,
        difficultyModifier: Math.max(0.5, difficultyMod),
      });

      const gained = skill.addXP(effectiveXP);
      if (gained > 0) {
        levelUps.set(skill.name, gained);
      }
    }

    this.completedQuestIds.add(quest.definitionId);
    this.activeQuests.splice(questIndex, 1);
    this.title = this.dynamicTitle;

    return levelUps;
  }

  // ========================
  // BOSS SYSTEM
  // ========================

  /** Verifica se il Player può affrontare un Boss */
  canFightBoss(boss: Boss): boolean {
    const skillLevels = new Map<string, number>();
    this.skills.forEach((skill, id) => skillLevels.set(id, skill.level));
    return boss.checkRequirements(skillLevels);
  }

  /** Registra la sconfitta di un Boss e ottieni le ricompense */
  defeatBoss(boss: Boss): Map<string, number> {
    const levelUps = new Map<string, number>();

    if (!boss.isDefeated) return levelUps;

    for (const reward of boss.defeatRewards) {
      const skill = this.skills.get(reward.skillId);
      if (!skill) continue;

      const gained = skill.addXP(reward.xp);
      if (gained > 0) {
        levelUps.set(skill.name, gained);
      }
    }

    this.defeatedBossIds.add(boss.id);
    this.title = this.dynamicTitle;

    return levelUps;
  }

  // ========================
  // ASSESSMENT & DEBUFF
  // ========================

  /** Registra un assessment giornaliero */
  recordAssessment(assessment: DailyAssessment): void {
    this.assessmentHistory.push(assessment);
    this.activeDebuffs = assessment.activeDebuffs;

    // Aggiorna streak
    const today = new Date().toISOString().split('T')[0];
    if (this.lastLoginDate !== today) {
      const lastDate = new Date(this.lastLoginDate);
      const todayDate = new Date(today);
      const diffDays = Math.floor(
        (todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays === 1) {
        this.currentStreak++;
      } else if (diffDays > 1) {
        this.currentStreak = 1;
      }

      this.longestStreak = Math.max(this.longestStreak, this.currentStreak);
      this.lastLoginDate = today;
    }
  }

  /** HRV medio delle ultime N sessioni */
  getAverageHRV(sessions = 7): number {
    const recent = this.assessmentHistory.slice(-sessions);
    if (recent.length === 0) return 0;
    return recent.reduce((sum, a) => sum + a.hrv, 0) / recent.length;
  }

  /** Calcola la penalità debuff per una categoria */
  private calculateDebuffPenalty(category: SkillCategory): number {
    return this.activeDebuffs
      .filter((d) => d.affectedCategories.includes(category))
      .reduce((penalty, d) => penalty + (1 - d.severityMultiplier), 0);
  }

  // ========================
  // STATS & SERIALIZATION
  // ========================

  getStats(): PlayerStats {
    return {
      totalLevel: this.totalLevel,
      categoryLevels: {
        PHYSIQUE: this.getCategoryLevel('PHYSIQUE'),
        NEURAL: this.getCategoryLevel('NEURAL'),
        COGNITIVE: this.getCategoryLevel('COGNITIVE'),
        SOCIAL: this.getCategoryLevel('SOCIAL'),
      },
      totalXP: Array.from(this.skills.values()).reduce((s, sk) => s + sk.totalXPEarned, 0),
      questsCompleted: this.completedQuestIds.size,
      bossesDefeated: this.defeatedBossIds.size,
      currentStreak: this.currentStreak,
      longestStreak: this.longestStreak,
    };
  }

  /** Serializza per il database */
  toJSON(): PlayerData {
    return {
      id: this.id,
      name: this.name,
      title: this.title,
      createdAt: this.createdAt,
      lastLoginDate: this.lastLoginDate,
      skills: Array.from(this.skills.values()),
      activeQuests: this.activeQuests,
      completedQuestIds: Array.from(this.completedQuestIds),
      defeatedBossIds: Array.from(this.defeatedBossIds),
      assessmentHistory: this.assessmentHistory,
      activeDebuffs: this.activeDebuffs,
      currentStreak: this.currentStreak,
      longestStreak: this.longestStreak,
    };
  }
}
