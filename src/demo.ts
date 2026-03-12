// ============================================
// NEURO-LEVELING — Demo / Simulazione Completa
// ============================================

import { Player } from './models/Player';
import { Skill, SKILL_DEFINITIONS } from './models/Skill';
import { Quest, QUEST_DEFINITIONS } from './models/Quest';
import { Boss, BOSS_DEFINITIONS } from './models/Boss';
import { AssessmentEngine, AssessmentInput } from './services/AssessmentEngine';
import { LevelingEngine } from './services/LevelingEngine';
import { createAIService } from './services/AIService';
import { Dashboard } from './ui/Dashboard';
import { QuestBoard } from './ui/QuestBoard';
import { BossChamber } from './ui/BossChamber';
import { AssessmentScreen } from './ui/AssessmentScreen';

// ========================
// HELPER
// ========================

function separator(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60) + '\n');
}

// ========================
// MAIN DEMO
// ========================

async function main() {
  separator('NEURO-LEVELING — System Boot');
  console.log('Inizializzazione del sistema...\n');

  // 1. Crea Player
  const player = new Player('player_001', 'Amedeo');
  console.log(`Player creato: ${player.name}`);
  console.log(`Titolo: ${player.dynamicTitle}`);
  console.log(`Livello totale: ${player.totalLevel}`);
  console.log(`Skills inizializzate: ${player.skills.size}`);

  // 2. Daily Assessment — "The Awakening"
  separator('THE AWAKENING — Daily Assessment');
  const engine = new AssessmentEngine();

  const morningInput: AssessmentInput = {
    hrv: 55,        // ms — leggermente sotto la media
    boltScore: 18,  // secondi — zona insufficiente
    moodScore: 6,
    energyScore: 5,
    sleepQuality: 4, // Notte mediocre
  };

  console.log('Input biometrico:');
  console.log(`  HRV: ${morningInput.hrv}ms`);
  console.log(`  BOLT: ${morningInput.boltScore}s`);
  console.log(`  Mood: ${morningInput.moodScore}/10`);
  console.log(`  Energy: ${morningInput.energyScore}/10`);
  console.log(`  Sleep: ${morningInput.sleepQuality}/10`);

  const assessment = engine.processAndApply(player, morningInput);
  console.log(`\nSNA State: ${assessment.ansState}`);
  console.log(`Debuffs attivi: ${assessment.activeDebuffs.length}`);
  for (const d of assessment.activeDebuffs) {
    console.log(`  ⊘ ${d.name}: ${d.description}`);
  }

  // Render Assessment Screen
  const assessResult = AssessmentScreen.processAndBuildResult(player, morningInput, engine);
  console.log(AssessmentScreen.renderResultASCII(assessResult));

  // 3. Shadow Guide Briefing
  separator('SHADOW GUIDE — Daily Briefing');
  const aiService = createAIService(); // Senza API key, usa logica locale
  const briefing = await aiService.generateDailyBriefing(player, assessment);

  console.log('[STATUS REPORT]');
  console.log(briefing.statusReport);
  console.log('\n[PRIORITY QUEUE]');
  for (const q of briefing.priorityQueue) {
    console.log(`  ${q}`);
  }
  console.log('\n[TACTICAL ADVISORY]');
  console.log(briefing.tacticalAdvisory);
  if (briefing.alerts.length > 0) {
    console.log('\n[ALERTS]');
    for (const a of briefing.alerts) {
      console.log(`  ${a}`);
    }
  }

  // 4. Quest System
  separator('QUEST BOARD — Assegnazione Daily Quests');

  // Assegna le quest suggerite al player
  const today = new Date().toISOString().split('T')[0];
  for (const questDef of briefing.suggestedQuests) {
    const quest = new Quest(questDef, today);
    player.activeQuests.push(quest);
  }

  const questBoardData = QuestBoard.build(player, briefing.suggestedQuests);
  console.log(QuestBoard.renderASCII(questBoardData));

  // 5. Completamento Quest — Simula
  separator('QUEST COMPLETION — Simulazione');

  // Simula il completamento della prima quest disponibile
  if (player.activeQuests.length > 0) {
    const questToComplete = player.activeQuests[0];
    questToComplete.start();
    console.log(`Quest iniziata: ${questToComplete.name}`);
    console.log(`Protocollo:`);
    for (const step of questToComplete.protocol) {
      console.log(`  → ${step}`);
    }

    // XP Preview
    const preview = LevelingEngine.previewQuestXP(
      player,
      QUEST_DEFINITIONS.find((q) => q.id === questToComplete.definitionId)!
    );
    console.log('\nXP Preview:');
    for (const p of preview) {
      console.log(`  ${p.skillName}: ${p.rawXP} base → ${p.effectiveXP} effettivi`);
    }

    // Completa la quest
    const report = LevelingEngine.processQuestCompletion(player, questToComplete);
    console.log(`\n✓ Quest "${report.questName}" completata!`);
    console.log(`  XP totali guadagnati: ${report.totalXPGained}`);

    if (report.levelUpEvents.length > 0) {
      console.log('  LEVEL UP!');
      for (const lu of report.levelUpEvents) {
        console.log(`    ★ ${lu.skillName}: Lv.${lu.oldLevel} → Lv.${lu.newLevel}`);
      }
    }

    console.log(`  Player Level: ${report.playerNewTotalLevel}`);
  }

  // Completa anche la seconda quest se disponibile
  if (player.activeQuests.length > 0) {
    const quest2 = player.activeQuests[0];
    quest2.start();
    const report2 = LevelingEngine.processQuestCompletion(player, quest2);
    console.log(`\n✓ Quest "${report2.questName}" completata! (+${report2.totalXPGained} XP)`);
    for (const lu of report2.levelUpEvents) {
      console.log(`  ★ ${lu.skillName}: Lv.${lu.oldLevel} → Lv.${lu.newLevel}`);
    }
  }

  // 6. Boss Chamber
  separator('BOSS CHAMBER — Emotional Overlords');

  const bossChamberData = BossChamber.build(player);
  console.log(BossChamber.renderASCII(bossChamberData));

  // Mostra requisiti per ogni boss
  for (const boss of bossChamberData.availableBosses) {
    const canFight = boss.isUnlocked;
    console.log(`\n${boss.name} (Lv.${boss.level}) — ${canFight ? 'SBLOCCATO ⚔' : 'BLOCCATO 🔒'}`);
    for (const req of boss.requirements) {
      console.log(`  ${req.met ? '✓' : '✗'} ${req.skillName}: ${req.currentLevel}/${req.requiredLevel}`);
    }
  }

  // 7. Simulazione avanzamento: porta le skill al livello necessario per il Boss
  separator('TRAINING MONTAGE — Simulazione avanzamento');

  // Simula 30 giorni di quest per portare le skill al livello necessario
  console.log('Simulazione di 30 giorni di allenamento...\n');
  for (let day = 0; day < 30; day++) {
    player.currentStreak++;

    // Simula assessment giornaliero positivo
    const dailyInput: AssessmentInput = {
      hrv: 60 + Math.floor(Math.random() * 30),
      boltScore: 20 + Math.floor(Math.random() * 15),
      moodScore: 6 + Math.floor(Math.random() * 4),
      energyScore: 6 + Math.floor(Math.random() * 4),
      sleepQuality: 6 + Math.floor(Math.random() * 4),
    };
    engine.processAndApply(player, dailyInput);

    // Completa 3 quest al giorno
    for (let q = 0; q < 3; q++) {
      const randomQuestDef = QUEST_DEFINITIONS[Math.floor(Math.random() * QUEST_DEFINITIONS.length)];
      const quest = new Quest(randomQuestDef, `sim_day_${day}`);
      player.activeQuests.push(quest);
      quest.start();
      LevelingEngine.processQuestCompletion(player, quest);
    }

    // Streak bonus ogni 7 giorni
    LevelingEngine.processStreakBonus(player);
  }

  const statsAfter = player.getStats();
  console.log('Dopo 30 giorni di allenamento:');
  console.log(`  Livello Totale: ${statsAfter.totalLevel}`);
  console.log(`  PHYSIQUE:  Lv.${statsAfter.categoryLevels.PHYSIQUE}`);
  console.log(`  NEURAL:    Lv.${statsAfter.categoryLevels.NEURAL}`);
  console.log(`  COGNITIVE: Lv.${statsAfter.categoryLevels.COGNITIVE}`);
  console.log(`  SOCIAL:    Lv.${statsAfter.categoryLevels.SOCIAL}`);
  console.log(`  Quest completate: ${statsAfter.questsCompleted}`);
  console.log(`  Streak: ${statsAfter.currentStreak} giorni`);
  console.log(`  Titolo: ${player.dynamicTitle}`);

  // 8. Boss Fight!
  separator('BOSS FIGHT — Anxiety Wraith');

  const anxietyDef = BOSS_DEFINITIONS.find((b) => b.id === 'ANXIETY_WRAITH')!;
  const boss = BossChamber.initiateBattle(anxietyDef, player);

  if (boss) {
    console.log(`⚔ Battaglia iniziata contro ${boss.name}!`);
    console.log(`HP: ${boss.currentHP}/${boss.maxHP}\n`);

    while (boss.phase === 'IN_BATTLE') {
      const step = boss.executeProtocolStep();
      if (step) {
        const narration = await aiService.generateBossFightNarration(
          boss, boss.currentProtocolStep - 1, player
        );
        console.log(`Step ${boss.currentProtocolStep}/${boss.battleProtocol.length}:`);
        console.log(`  ${step.instruction.slice(0, 80)}...`);
        console.log(`  Target: ${step.targetEffect.slice(0, 80)}`);
        console.log(`  HP: ${boss.currentHP}/${boss.maxHP} (${boss.hpPercent.toFixed(0)}%)`);
        console.log(`  Shadow Guide: ${narration.slice(0, 100)}`);
        console.log('');
      }
    }

    if (boss.isDefeated) {
      console.log(`☠ ${boss.name} SCONFITTO!\n`);
      const bossReport = LevelingEngine.processBossDefeat(player, boss);
      console.log(`XP totali guadagnati: ${bossReport.totalXPGained}`);
      for (const lu of bossReport.levelUpEvents) {
        console.log(`  ★ ${lu.skillName}: Lv.${lu.oldLevel} → Lv.${lu.newLevel}`);
      }
    }
  } else {
    console.log('Requisiti non soddisfatti per affrontare il Boss.');
    const projections = LevelingEngine.projectionSummary(player);
    console.log('Proiezioni:');
    for (const p of projections) {
      console.log(`  ${p}`);
    }
  }

  // 9. Status Window Finale
  separator('STATUS WINDOW — Final');
  const dashboardData = Dashboard.build(player);
  console.log(Dashboard.renderStatusWindowASCII(dashboardData.statusWindow));

  // Stats finali
  const finalStats = player.getStats();
  console.log('\n--- STATS FINALI ---');
  console.log(`XP Totali: ${finalStats.totalXP}`);
  console.log(`Quest Completate: ${finalStats.questsCompleted}`);
  console.log(`Boss Sconfitti: ${finalStats.bossesDefeated}`);
  console.log(`Streak Più Lungo: ${finalStats.longestStreak}`);

  separator('SYSTEM — Shutdown');
  console.log('NEURO-LEVELING demo completata.');
}

main().catch(console.error);
