-- Users: track OAuth provider for future GitHub OAuth support
ALTER TABLE users ADD COLUMN provider TEXT NOT NULL DEFAULT 'google';

-- Entries: namespace scoping ('work' | 'personal' | 'shared' | null)
ALTER TABLE entries ADD COLUMN namespace TEXT;

-- Entries: pinned/always-on (0 = false, 1 = true)
ALTER TABLE entries ADD COLUMN pinned INTEGER DEFAULT 0;

-- Entries: resource type fields (only populated when type = 'resource')
ALTER TABLE entries ADD COLUMN resource_name TEXT;
ALTER TABLE entries ADD COLUMN resource_location TEXT;

-- Entries: staleness tracking (unix ms, set when user confirms a fact is current)
ALTER TABLE entries ADD COLUMN confirmed_at INTEGER;

-- Index for efficient namespace filtering
CREATE INDEX idx_entries_user_namespace ON entries (user_id, namespace);
