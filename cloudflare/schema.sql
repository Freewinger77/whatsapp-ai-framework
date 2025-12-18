-- WhatsApp AI Chatbot - D1 Database Schema
-- Run with: npx wrangler d1 execute whatsapp-bot-db --file=./schema.sql

-- ============================================================================
-- Chat States Table
-- Tracks AI enabled/disabled state per chat
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_states (
  chat_id TEXT PRIMARY KEY,
  ai_enabled INTEGER DEFAULT 1,  -- 1 = enabled, 0 = disabled
  paused_until TEXT,             -- ISO datetime when AI should resume
  assigned_agent TEXT,           -- Agent who took over the chat
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for finding paused chats
CREATE INDEX IF NOT EXISTS idx_chat_states_paused
ON chat_states(ai_enabled, paused_until);

-- ============================================================================
-- Escalations Table
-- Records when conversations are escalated to human agents
-- ============================================================================
CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_question TEXT,
  reason TEXT,
  agent_id TEXT,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index for finding escalations by chat
CREATE INDEX IF NOT EXISTS idx_escalations_chat
ON escalations(chat_id);

-- Index for finding unresolved escalations
CREATE INDEX IF NOT EXISTS idx_escalations_unresolved
ON escalations(resolved_at) WHERE resolved_at IS NULL;

-- ============================================================================
-- Agents Table
-- Registry of human agents who can handle escalations
-- ============================================================================
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notification_channel TEXT,  -- Format: "telegram:123456" or "discord:webhook_url"
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- Analytics Table (Optional)
-- Track conversation statistics for insights
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversation_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  escalation_count INTEGER DEFAULT 0,
  avg_confidence REAL,
  languages_used TEXT,  -- JSON array of detected languages
  last_interaction TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_stats_chat
ON conversation_stats(chat_id);

-- ============================================================================
-- Trigger to update timestamps
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS update_chat_states_timestamp
AFTER UPDATE ON chat_states
BEGIN
  UPDATE chat_states SET updated_at = datetime('now') WHERE chat_id = NEW.chat_id;
END;
