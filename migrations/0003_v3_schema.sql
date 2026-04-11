-- V3: Context Engine
-- Expand entry types to 9 domains (type column is TEXT, no enum constraint — values enforced in app layer)
-- Add supersedes column for decision chain tracking
ALTER TABLE entries ADD COLUMN supersedes TEXT;

-- Relationships table for typed, directional, temporal edges between entries
CREATE TABLE relationships (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  rel_type    TEXT NOT NULL,
  label       TEXT,
  valid_from  INTEGER NOT NULL,
  valid_to    INTEGER,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (source_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX idx_rel_source ON relationships(source_id);
CREATE INDEX idx_rel_target ON relationships(target_id);
CREATE INDEX idx_rel_type ON relationships(rel_type);
