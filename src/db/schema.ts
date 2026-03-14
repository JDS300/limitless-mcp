export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  provider: string;           // 'google' | 'github' etc. DEFAULT 'google'
  created_at: number;
  last_seen: number;
}

export interface EntryRow {
  id: string;
  user_id: string;
  type: 'context' | 'memory' | 'handoff' | 'resource';
  status: 'active' | 'needs_action' | 'actioned';
  title: string | null;
  content: string;                    // encrypted at rest, decrypted in responses
  tags: string | null;
  namespace: string | null;           // 'work' | 'personal' | 'shared' | null
  pinned: number;                     // 0 | 1 (SQLite boolean)
  resource_name: string | null;       // type='resource' only
  resource_location: string | null;   // type='resource' only
  confirmed_at: number | null;        // unix ms
  created_at: number;
  updated_at: number;
}
