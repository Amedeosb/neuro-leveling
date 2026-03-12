// ============================================
// NEURO-LEVELING — UI: Dashboard (Status Window)
// ============================================
// Stile Solo Leveling: Dark Mode, Blu elettrico (#00D4FF), 
// Font futuristico, interfacce "System UI"
// ============================================

import { Player } from '../models/Player';
import { SkillCategory } from '../types';
import { Skill } from '../models/Skill';

// ========================
// THEME
// ========================

export const NEURO_THEME = {
  colors: {
    background: '#0A0A14',
    backgroundSecondary: '#12121F',
    surface: '#1A1A2E',
    surfaceHover: '#252540',
    primary: '#00D4FF',       // Blu elettrico Solo Leveling
    primaryDim: '#0088AA',
    secondary: '#7B2FFF',     // Viola portale
    accent: '#FF3366',        // Rosso per alert/danger
    success: '#00FF88',       // Verde neon
    warning: '#FFB800',       // Giallo ambra
    text: '#E8E8F0',
    textDim: '#8888AA',
    textMuted: '#555577',
    border: '#2A2A44',
    // Colori categoria
    physique: '#FF4444',
    neural: '#00D4FF',
    cognitive: '#FFB800',
    social: '#00FF88',
  },
  fonts: {
    heading: '"Orbitron", "Rajdhani", "Share Tech Mono", monospace',
    body: '"Rajdhani", "Inter", sans-serif',
    mono: '"Share Tech Mono", "JetBrains Mono", monospace',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
  },
  borderRadius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
  },
} as const;

// ========================
// DASHBOARD DATA
// ========================

export interface DashboardData {
  player: PlayerOverview;
  categoryBreakdown: CategoryBreakdown[];
  recentActivity: ActivityItem[];
  statusWindow: StatusWindowData;
}

export interface PlayerOverview {
  name: string;
  title: string;
  totalLevel: number;
  totalXP: number;
  currentStreak: number;
  longestStreak: number;
  questsCompleted: number;
  bossesDefeated: number;
}

export interface CategoryBreakdown {
  category: SkillCategory;
  level: number;
  skills: SkillSummary[];
  color: string;
}

export interface SkillSummary {
  name: string;
  level: number;
  progressPercent: number;
  xpToNext: number;
}

export interface ActivityItem {
  timestamp: number;
  type: 'QUEST_COMPLETE' | 'LEVEL_UP' | 'BOSS_DEFEATED' | 'ASSESSMENT' | 'DEBUFF';
  title: string;
  detail: string;
  category?: SkillCategory;
}

export interface StatusWindowData {
  // Il "Status Window" à la Solo Leveling
  playerName: string;
  playerTitle: string;
  level: number;
  physique: number;
  neural: number;
  cognitive: number;
  social: number;
  activeDebuffs: string[];
  activeBuffs: string[];
}

// ========================
// DASHBOARD BUILDER
// ========================

export class Dashboard {
  static build(player: Player): DashboardData {
    const stats = player.getStats();

    return {
      player: {
        name: player.name,
        title: player.dynamicTitle,
        totalLevel: stats.totalLevel,
        totalXP: stats.totalXP,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        questsCompleted: stats.questsCompleted,
        bossesDefeated: stats.bossesDefeated,
      },
      categoryBreakdown: this.buildCategoryBreakdown(player),
      recentActivity: [],
      statusWindow: this.buildStatusWindow(player, stats),
    };
  }

  private static buildCategoryBreakdown(player: Player): CategoryBreakdown[] {
    const categories: SkillCategory[] = ['PHYSIQUE', 'NEURAL', 'COGNITIVE', 'SOCIAL'];
    const colorMap: Record<SkillCategory, string> = {
      PHYSIQUE: NEURO_THEME.colors.physique,
      NEURAL: NEURO_THEME.colors.neural,
      COGNITIVE: NEURO_THEME.colors.cognitive,
      SOCIAL: NEURO_THEME.colors.social,
    };

    return categories.map((cat) => {
      const skills: SkillSummary[] = [];
      player.skills.forEach((skill) => {
        if (skill.category === cat) {
          skills.push({
            name: skill.name,
            level: skill.level,
            progressPercent: skill.progressPercent,
            xpToNext: skill.xpToNextLevel,
          });
        }
      });

      return {
        category: cat,
        level: player.getCategoryLevel(cat),
        skills,
        color: colorMap[cat],
      };
    });
  }

  private static buildStatusWindow(
    player: Player,
    stats: ReturnType<Player['getStats']>
  ): StatusWindowData {
    return {
      playerName: player.name,
      playerTitle: player.dynamicTitle,
      level: stats.totalLevel,
      physique: stats.categoryLevels.PHYSIQUE,
      neural: stats.categoryLevels.NEURAL,
      cognitive: stats.categoryLevels.COGNITIVE,
      social: stats.categoryLevels.SOCIAL,
      activeDebuffs: player.activeDebuffs.map((d) => d.name),
      activeBuffs: player.currentStreak >= 7 ? ['Streak Momentum (+25% XP)'] : [],
    };
  }

  /**
   * Genera un'ASCII art status window (per CLI/debug)
   */
  static renderStatusWindowASCII(data: StatusWindowData): string {
    const w = 50;
    const border = '═'.repeat(w);
    const bar = (value: number, max: number = 50) => {
      const filled = Math.round((value / max) * 20);
      return '█'.repeat(filled) + '░'.repeat(20 - filled);
    };

    return `
╔${border}╗
║  S T A T U S   W I N D O W                      ║
╠${border}╣
║  Player: ${data.playerName.padEnd(39)}║
║  Title:  ${data.playerTitle.padEnd(39)}║
║  Level:  ${String(data.level).padEnd(39)}║
╠${border}╣
║  PHYSIQUE  [${bar(data.physique)}] ${String(data.physique).padStart(3)}  ║
║  NEURAL    [${bar(data.neural)}] ${String(data.neural).padStart(3)}  ║
║  COGNITIVE [${bar(data.cognitive)}] ${String(data.cognitive).padStart(3)}  ║
║  SOCIAL    [${bar(data.social)}] ${String(data.social).padStart(3)}  ║
╠${border}╣
║  Debuffs: ${(data.activeDebuffs.length > 0 ? data.activeDebuffs.join(', ') : 'None').padEnd(38)}║
║  Buffs:   ${(data.activeBuffs.length > 0 ? data.activeBuffs.join(', ') : 'None').padEnd(38)}║
╚${border}╝`;
  }
}
