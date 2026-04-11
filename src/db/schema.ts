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
  type: 'identity' | 'rules' | 'catalog' | 'framework' | 'decision' | 'project' | 'handoff' | 'resource' | 'memory';
  status: 'active' | 'needs_action' | 'actioned';
  title: string | null;
  content: string;
  tags: string | null;
  namespace: string | null;
  pinned: number;
  resource_name: string | null;
  resource_location: string | null;
  confirmed_at: number | null;
  supersedes: string | null;
  created_at: number;
  updated_at: number;
}

export interface RelationshipRow {
  id: string;
  source_id: string;
  target_id: string;
  rel_type: string;
  label: string | null;
  valid_from: number;
  valid_to: number | null;
  created_at: number;
}
