// ============================================
// NEURO-LEVELING — AI Service (Shadow Guide)
// ============================================
import { DailyAssessment, SkillCategory, ANSState, Debuff } from '../types';
import { Player } from '../models/Player';
import { Quest, QUEST_DEFINITIONS, QuestDefinition } from '../models/Quest';
import { Boss, BOSS_DEFINITIONS } from '../models/Boss';

// ========================
// CONFIGURAZIONE AI
// ========================

const SHADOW_GUIDE_SYSTEM_PROMPT = `Sei lo Shadow Guide — il consulente d'elite del sistema NEURO-LEVELING.

IDENTITÀ:
- Sei un consulente in neuroscienze applicate, biohacking e ottimizzazione della performance.
- Il tuo tono è autorevole, asciutto, senza fronzoli. Stile Borzacchiello-Robbins.
- Usi terminologia tecnica: neuroplasticità, allostasi, SNA, HRV, tono vagale, corteccia prefrontale.
- NON usi parole deboli: "provare", "sperare", "forse", "un po'". Usa: "eseguire", "implementare", "attivare", "calibrare".

REGOLE COMUNICATIVE:
1. Ogni indicazione DEVE avere un razionale neuroscientifico sintetico.
2. Le emozioni sono SEGNALI BIOLOGICI, non debolezze. Le tratti come dati.
3. Quando i biomarcatori indicano sovrallenamento (HRV < 70% media), IMPONI il Rest Day. Non è negoziabile.
4. Formatta le risposte come briefing operativi: concisi, azionabili, con priorità chiare.
5. Usa metafore di Solo Leveling: "Dungeon", "Boss", "Quest", "Level Up", "Shadow Army".

STRUTTURA RISPOSTA:
[STATUS REPORT] → Analisi biomarcatori
[PRIORITY QUEUE] → Quests ordinate per urgenza neurofisiologica  
[TACTICAL ADVISORY] → Razionale scientifico sintetico
[ALERT] → Solo se ci sono condizioni critiche (debuff severi, sovrallenamento)`;

// ========================
// TIPI
// ========================

export interface ShadowGuideResponse {
  statusReport: string;
  priorityQueue: string[];
  tacticalAdvisory: string;
  alerts: string[];
  suggestedQuests: QuestDefinition[];
  isForcedRestDay: boolean;
}

export interface AIServiceConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

// ========================
// AI SERVICE
// ========================

export class AIService {
  private config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = config;
  }

  /**
   * Genera il briefing giornaliero dello Shadow Guide basato sull'assessment.
   * Usa la logica deterministica come fallback se l'API non è disponibile.
   */
  async generateDailyBriefing(
    player: Player,
    assessment: DailyAssessment
  ): Promise<ShadowGuideResponse> {
    const avgHRV = player.getAverageHRV(7);
    const isForcedRestDay = avgHRV > 0 && assessment.hrv < avgHRV * 0.7;

    // Genera briefing deterministico (logica locale)
    const localBriefing = this.generateLocalBriefing(player, assessment, avgHRV, isForcedRestDay);

    // Se l'API key è configurata, arricchisci con GPT-4o
    if (this.config.apiKey) {
      try {
        const aiBriefing = await this.callOpenAI(player, assessment, avgHRV, isForcedRestDay);
        return { ...localBriefing, ...aiBriefing };
      } catch {
        // Fallback alla logica locale
        return localBriefing;
      }
    }

    return localBriefing;
  }

  /**
   * Genera la risposta dell'AI durante una Boss Fight
   */
  async generateBossFightNarration(
    boss: Boss,
    stepIndex: number,
    player: Player
  ): Promise<string> {
    const step = boss.battleProtocol[stepIndex];
    if (!step) return '';

    const prompt = `Il Player "${player.name}" (Lv.${player.totalLevel}) sta affrontando il Boss "${boss.name}" (${boss.title}).
HP Boss: ${boss.currentHP}/${boss.maxHP} (${boss.hpPercent.toFixed(0)}%)
Step ${stepIndex + 1}/${boss.battleProtocol.length}: ${step.instruction}
Effetto target: ${step.targetEffect}

Genera un breve commento tattico dello Shadow Guide (max 2 frasi, tono autorevole, con terminologia neuroscientifica).`;

    if (this.config.apiKey) {
      try {
        return await this.rawCompletion(prompt);
      } catch {
        return this.localBossFightNarration(boss, stepIndex);
      }
    }

    return this.localBossFightNarration(boss, stepIndex);
  }

  // ========================
  // LOGICA LOCALE (DETERMINISTICA)
  // ========================

  private generateLocalBriefing(
    player: Player,
    assessment: DailyAssessment,
    avgHRV: number,
    isForcedRestDay: boolean
  ): ShadowGuideResponse {
    const alerts: string[] = [];
    const suggestedQuests: QuestDefinition[] = [];

    // ---- STATUS REPORT ----
    const statusLines: string[] = [
      `HRV: ${assessment.hrv}ms (media 7gg: ${avgHRV.toFixed(0)}ms) → ${this.interpretHRV(assessment.hrv, avgHRV)}`,
      `BOLT Score: ${assessment.boltScore}s → ${this.interpretBOLT(assessment.boltScore)}`,
      `SNA State: ${this.interpretANS(assessment.ansState)}`,
      `Mood/Energy: ${assessment.moodScore}/10 — ${assessment.energyScore}/10`,
      `Streak: ${player.currentStreak} giorni`,
    ];
    const statusReport = statusLines.join('\n');

    // ---- FORCED REST DAY ----
    if (isForcedRestDay) {
      alerts.push(
        `⚠️ ALERT SOVRALLENAMENTO: HRV al ${((assessment.hrv / avgHRV) * 100).toFixed(0)}% della media. Rest Day forzato. Solo Parasympathetic Quests autorizzate.`
      );
      // Solo quest di recupero
      const recoveryQuests = QUEST_DEFINITIONS.filter((q) => q.type === 'RECOVERY');
      suggestedQuests.push(...recoveryQuests);
    } else {
      // ---- QUEST SUGGESTION LOGIC ----
      suggestedQuests.push(...this.selectQuests(player, assessment));
    }

    // ---- DEBUFF ALERTS ----
    for (const debuff of assessment.activeDebuffs) {
      alerts.push(`DEBUFF "${debuff.name}": ${debuff.description} (${debuff.affectedCategories.join(', ')} penalizzate del ${((1 - debuff.severityMultiplier) * 100).toFixed(0)}%)`);
    }

    // ---- TACTICAL ADVISORY ----
    const tacticalAdvisory = this.generateTacticalAdvice(assessment, isForcedRestDay);

    // ---- PRIORITY QUEUE ----
    const priorityQueue = suggestedQuests
      .sort((a, b) => this.getQuestPriority(a, assessment) - this.getQuestPriority(b, assessment))
      .map((q, i) => `${i + 1}. [${q.category}] ${q.name} — ${q.durationMinutes}min — Diff: ${q.difficulty}/10`);

    return {
      statusReport,
      priorityQueue,
      tacticalAdvisory,
      alerts,
      suggestedQuests,
      isForcedRestDay,
    };
  }

  private selectQuests(player: Player, assessment: DailyAssessment): QuestDefinition[] {
    const selected: QuestDefinition[] = [];

    for (const quest of QUEST_DEFINITIONS) {
      // Verifica requisiti
      const meetsRequirements = quest.requirements.every((req) => {
        const skill = player.skills.get(req.skillId);
        return skill && skill.level >= req.minLevel;
      });

      if (!meetsRequirements) continue;

      // Se HRV basso, favorisci quest a bassa intensità
      const avgHRV = player.getAverageHRV(7);
      if (avgHRV > 0 && assessment.hrv < avgHRV * 0.85 && quest.difficulty > 5) {
        continue; // Salta se HRV sub-ottimale e quest è impegnativa
      }

      // Se simpatico dominante, favorisci quest parasimpatiche
      if (assessment.ansState === 'SYMPATHETIC_DOMINANT' && quest.category === 'PHYSIQUE' && quest.difficulty > 6) {
        continue;
      }

      selected.push(quest);
    }

    return selected.slice(0, 5); // Max 5 quest al giorno
  }

  private getQuestPriority(quest: QuestDefinition, assessment: DailyAssessment): number {
    let priority = 50; // base

    // Recovery quests hanno massima priorità se HRV basso
    if (quest.type === 'RECOVERY') priority -= 30;

    // Se simpatico dominante, priorità a Social
    if (assessment.ansState === 'SYMPATHETIC_DOMINANT' && quest.category === 'SOCIAL') {
      priority -= 20;
    }

    // Se parasimpatico dominante, priorità a Physique/Cognitive
    if (assessment.ansState === 'PARASYMPATHETIC_DOMINANT') {
      if (quest.category === 'PHYSIQUE' || quest.category === 'COGNITIVE') {
        priority -= 15;
      }
    }

    // Priorità più bassa per quest molto difficili se mood/energy bassi
    if (assessment.moodScore < 5 || assessment.energyScore < 5) {
      priority += quest.difficulty * 3;
    }

    return priority;
  }

  private interpretHRV(current: number, average: number): string {
    if (average === 0) return 'Baseline non ancora stabilita';
    const ratio = current / average;
    if (ratio >= 1.1) return 'ECCELLENTE — Sistema parasimpatico dominante. Performance window aperta.';
    if (ratio >= 0.9) return 'NOMINALE — SNA in equilibrio. Tutte le Quest autorizzate.';
    if (ratio >= 0.7) return 'SUB-OTTIMALE — Carico allostatico elevato. Ridurre intensità.';
    return 'CRITICO — Sovrallenamento neurale. Solo Recovery autorizzato.';
  }

  private interpretBOLT(boltScore: number): string {
    if (boltScore >= 40) return 'ECCELLENTE — Tolleranza CO2 avanzata. Respirazione nasale consolidata.';
    if (boltScore >= 25) return 'BUONO — Chemocettori in fase di calibrazione. Continuare il protocollo.';
    if (boltScore >= 15) return 'INSUFFICIENTE — Iperventilazione cronica probabile. Priorità: protocolli respiratori.';
    return 'CRITICO — Chemosensibilità alla CO2 compromessa. Intervento respiratorio urgente.';
  }

  private interpretANS(state: ANSState): string {
    switch (state) {
      case 'SYMPATHETIC_DOMINANT':
        return 'ALLERTA — Fight-or-flight attivo. Priorità: vagal brake e down-regulation.';
      case 'BALANCED':
        return 'EQUILIBRATO — Finestra ottimale per challenge di alto livello.';
      case 'PARASYMPATHETIC_DOMINANT':
        return 'RIPOSO — Stato di recupero. Ideale per compiti cognitivi e creativi.';
    }
  }

  private generateTacticalAdvice(assessment: DailyAssessment, isRestDay: boolean): string {
    if (isRestDay) {
      return 'PROTOCOLLO REST DAY: Il tuo sistema nervoso è in sovraccarico allostatico. Oggi lavori esclusivamente sul recupero parasimpatico. Nessuna eccezione. L\'anti-fragilità si costruisce nei periodi di recupero, non nello sforzo cronico.';
    }

    if (assessment.ansState === 'SYMPATHETIC_DOMINANT') {
      return 'Il tuo SNA è sbilanciato verso il simpatico. Prima di qualsiasi performance task, esegui il Vagal Reset. La corteccia prefrontale funziona a regime SOLO quando il vago ventrale è online. Senza quello, stai operando in modalità sopravvivenza, non performance.';
    }

    if (assessment.boltScore < 20) {
      return 'Il tuo BOLT Score indica iperventilazione cronica. Questo significa eccesso di CO2 blow-off: il tuo sangue è troppo alcalino, l\'emoglobina non rilascia ossigeno ai tessuti (effetto Bohr). Priorità: protocolli di respirazione ridotta e tolleranza CO2.';
    }

    if (assessment.energyScore < 4) {
      return 'Energy Score critico. Non forzare la macchina quando il carburante è basso: si rompono gli ingranaggi. Oggi: un micro-protocollo di cold exposure per il boost noradrenergico, poi focus su UNA sola quest cognitiva.';
    }

    return 'Biomarcatori nel range ottimale. Tutte le Quest sono autorizzate. Consiglio: attacca il Dungeon più difficile nelle prime 4 ore della giornata quando il cortisolo endogeno è al picco e la corteccia prefrontale è al massimo della sua capacità esecutiva.';
  }

  private localBossFightNarration(boss: Boss, stepIndex: number): string {
    const step = boss.battleProtocol[stepIndex];
    const hpPercent = boss.hpPercent;

    if (hpPercent > 75) {
      return `Il ${boss.name} è ancora al ${hpPercent.toFixed(0)}% HP. Esegui il protocollo con precisione: ${step.targetEffect}`;
    }
    if (hpPercent > 25) {
      return `${boss.name} vacilla — ${hpPercent.toFixed(0)}% HP. La tua neuroplasticità self-directed sta riscrivendo il pattern. Continua.`;
    }
    return `${boss.name} è quasi sconfitto. Ultimo sforzo. Il tuo SNA sta creando un nuovo set-point omeostatico. Questo IS il level-up.`;
  }

  // ========================
  // OPENAI API INTEGRATION
  // ========================

  private async callOpenAI(
    player: Player,
    assessment: DailyAssessment,
    avgHRV: number,
    isForcedRestDay: boolean
  ): Promise<Partial<ShadowGuideResponse>> {
    const stats = player.getStats();

    const userPrompt = `PLAYER DATA:
- Nome: ${player.name} | Titolo: ${player.title} | Livello: ${stats.totalLevel}
- Livelli categoria: PHY=${stats.categoryLevels.PHYSIQUE} | NEU=${stats.categoryLevels.NEURAL} | COG=${stats.categoryLevels.COGNITIVE} | SOC=${stats.categoryLevels.SOCIAL}
- Streak: ${stats.currentStreak} giorni | Quest completate: ${stats.questsCompleted} | Boss sconfitti: ${stats.bossesDefeated}

ASSESSMENT ODIERNO (The Awakening):
- HRV: ${assessment.hrv}ms (media 7gg: ${avgHRV.toFixed(0)}ms, ratio: ${avgHRV > 0 ? (assessment.hrv / avgHRV * 100).toFixed(0) : 'N/A'}%)
- BOLT Score: ${assessment.boltScore}s
- Mood: ${assessment.moodScore}/10 | Energy: ${assessment.energyScore}/10 | Sleep: ${assessment.sleepQuality}/10
- ANS State: ${assessment.ansState}
- Debuff attivi: ${assessment.activeDebuffs.length > 0 ? assessment.activeDebuffs.map(d => d.name).join(', ') : 'Nessuno'}
- Forced Rest Day: ${isForcedRestDay ? 'SÌ' : 'NO'}

Genera il briefing giornaliero completo seguendo la struttura: [STATUS REPORT] → [PRIORITY QUEUE] → [TACTICAL ADVISORY] → [ALERT se necessario]`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: SHADOW_GUIDE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? '';

    return {
      tacticalAdvisory: content,
    };
  }

  private async rawCompletion(prompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: SHADOW_GUIDE_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }
}

// ========================
// FACTORY
// ========================

export function createAIService(apiKey?: string): AIService {
  return new AIService({
    apiKey: apiKey ?? '',
    model: 'gpt-4o',
    maxTokens: 1000,
    temperature: 0.7,
  });
}
