-- ============================================
-- NEURO-LEVELING — Database Schema (SQL)
-- Compatibile con SQLite / PostgreSQL
-- ============================================

-- ========================
-- PLAYER
-- ========================
CREATE TABLE players (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    title           TEXT NOT NULL DEFAULT 'Neophyte',
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_date DATE NOT NULL DEFAULT CURRENT_DATE,
    current_streak  INTEGER NOT NULL DEFAULT 0,
    longest_streak  INTEGER NOT NULL DEFAULT 0
);

-- ========================
-- SKILL DEFINITIONS (Catalogo immutabile)
-- ========================
CREATE TABLE skill_definitions (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    category            TEXT NOT NULL CHECK (category IN ('PHYSIQUE', 'NEURAL', 'COGNITIVE', 'SOCIAL')),
    description         TEXT NOT NULL,
    neurological_basis  TEXT NOT NULL,
    max_level           INTEGER NOT NULL DEFAULT 50
);

-- ========================
-- PLAYER SKILLS (Progressi del giocatore)
-- ========================
CREATE TABLE player_skills (
    player_id       TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    skill_id        TEXT NOT NULL REFERENCES skill_definitions(id),
    level           INTEGER NOT NULL DEFAULT 1,
    current_xp      INTEGER NOT NULL DEFAULT 0,
    total_xp_earned INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (player_id, skill_id)
);

CREATE INDEX idx_player_skills_category ON player_skills(skill_id);

-- ========================
-- DAILY ASSESSMENTS ("The Awakening")
-- ========================
CREATE TABLE daily_assessments (
    id              TEXT PRIMARY KEY,
    player_id       TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    assessment_date DATE NOT NULL,
    hrv             REAL NOT NULL,           -- Heart Rate Variability (ms)
    bolt_score      REAL NOT NULL,           -- Body Oxygen Level Test (secondi)
    mood_score      INTEGER NOT NULL CHECK (mood_score BETWEEN 1 AND 10),
    energy_score    INTEGER NOT NULL CHECK (energy_score BETWEEN 1 AND 10),
    sleep_quality   INTEGER NOT NULL CHECK (sleep_quality BETWEEN 1 AND 10),
    ans_state       TEXT NOT NULL CHECK (ans_state IN ('SYMPATHETIC_DOMINANT', 'BALANCED', 'PARASYMPATHETIC_DOMINANT')),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (player_id, assessment_date)
);

CREATE INDEX idx_assessments_player_date ON daily_assessments(player_id, assessment_date);

-- ========================
-- DEBUFFS (attivi su un assessment)
-- ========================
CREATE TABLE active_debuffs (
    id                  TEXT PRIMARY KEY,
    assessment_id       TEXT NOT NULL REFERENCES daily_assessments(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL,
    affected_categories TEXT NOT NULL,        -- JSON array: ["PHYSIQUE", "COGNITIVE"]
    severity_multiplier REAL NOT NULL CHECK (severity_multiplier BETWEEN 0.0 AND 1.0),
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ========================
-- QUEST DEFINITIONS (Catalogo)
-- ========================
CREATE TABLE quest_definitions (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    description             TEXT NOT NULL,
    scientific_rationale    TEXT NOT NULL,
    type                    TEXT NOT NULL CHECK (type IN ('DAILY', 'WEEKLY', 'BOSS', 'RECOVERY')),
    category                TEXT NOT NULL CHECK (category IN ('PHYSIQUE', 'NEURAL', 'COGNITIVE', 'SOCIAL')),
    difficulty              INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 10),
    duration_minutes        INTEGER NOT NULL,
    protocol                TEXT NOT NULL     -- JSON array di step
);

-- Requisiti per sbloccare una quest
CREATE TABLE quest_requirements (
    quest_id    TEXT NOT NULL REFERENCES quest_definitions(id) ON DELETE CASCADE,
    skill_id    TEXT NOT NULL REFERENCES skill_definitions(id),
    min_level   INTEGER NOT NULL,
    PRIMARY KEY (quest_id, skill_id)
);

-- Ricompense per il completamento della quest
CREATE TABLE quest_rewards (
    id          TEXT PRIMARY KEY,
    quest_id    TEXT NOT NULL REFERENCES quest_definitions(id) ON DELETE CASCADE,
    skill_id    TEXT NOT NULL REFERENCES skill_definitions(id),
    xp_amount   INTEGER NOT NULL
);

-- ========================
-- PLAYER QUESTS (Istanze assegnate)
-- ========================
CREATE TABLE player_quests (
    id              TEXT PRIMARY KEY,
    player_id       TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    quest_def_id    TEXT NOT NULL REFERENCES quest_definitions(id),
    status          TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'LOCKED')),
    assigned_date   DATE NOT NULL,
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_player_quests_status ON player_quests(player_id, status);
CREATE INDEX idx_player_quests_date ON player_quests(player_id, assigned_date);

-- ========================
-- BOSS DEFINITIONS (Emotional Overlords)
-- ========================
CREATE TABLE boss_definitions (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    title                   TEXT NOT NULL,
    description             TEXT NOT NULL,
    neurological_profile    TEXT NOT NULL,
    max_hp                  INTEGER NOT NULL,
    level                   INTEGER NOT NULL,
    weaknesses              TEXT NOT NULL,    -- JSON array: ["SOCIAL", "PHYSIQUE"]
    battle_protocol         TEXT NOT NULL     -- JSON array di step objects
);

-- Requisiti per affrontare un boss
CREATE TABLE boss_requirements (
    boss_id     TEXT NOT NULL REFERENCES boss_definitions(id) ON DELETE CASCADE,
    skill_id    TEXT NOT NULL REFERENCES skill_definitions(id),
    min_level   INTEGER NOT NULL,
    PRIMARY KEY (boss_id, skill_id)
);

-- Ricompense per la sconfitta del boss
CREATE TABLE boss_rewards (
    id          TEXT PRIMARY KEY,
    boss_id     TEXT NOT NULL REFERENCES boss_definitions(id) ON DELETE CASCADE,
    skill_id    TEXT NOT NULL REFERENCES skill_definitions(id),
    xp_amount   INTEGER NOT NULL
);

-- ========================
-- BOSS FIGHT HISTORY
-- ========================
CREATE TABLE boss_fights (
    id              TEXT PRIMARY KEY,
    player_id       TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    boss_id         TEXT NOT NULL REFERENCES boss_definitions(id),
    result          TEXT NOT NULL CHECK (result IN ('DEFEATED', 'RETREATED', 'IN_PROGRESS')),
    fight_date      DATE NOT NULL,
    steps_completed INTEGER NOT NULL DEFAULT 0,
    total_steps     INTEGER NOT NULL,
    started_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at    TIMESTAMP
);

CREATE INDEX idx_boss_fights_player ON boss_fights(player_id, boss_id);

-- ========================
-- LEVEL UP LOG (Storico level-up per analytics)
-- ========================
CREATE TABLE level_up_log (
    id          TEXT PRIMARY KEY,
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    skill_id    TEXT NOT NULL REFERENCES skill_definitions(id),
    old_level   INTEGER NOT NULL,
    new_level   INTEGER NOT NULL,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('QUEST', 'BOSS', 'BONUS')),
    trigger_id  TEXT,
    logged_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_level_up_player ON level_up_log(player_id, logged_at);

-- ========================
-- XP TRANSACTION LOG (Audit trail di tutti i guadagni XP)
-- ========================
CREATE TABLE xp_transactions (
    id              TEXT PRIMARY KEY,
    player_id       TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    skill_id        TEXT NOT NULL REFERENCES skill_definitions(id),
    xp_amount       INTEGER NOT NULL,
    source_type     TEXT NOT NULL CHECK (source_type IN ('QUEST', 'BOSS', 'BONUS', 'STREAK')),
    source_id       TEXT,
    debuff_penalty  REAL NOT NULL DEFAULT 0.0,
    streak_bonus    REAL NOT NULL DEFAULT 0.0,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_xp_transactions_player ON xp_transactions(player_id, created_at);
