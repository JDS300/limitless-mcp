export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  created_at: number;
  last_seen: number;
}

export interface EntryRow {
  id: string;
  user_id: string;
  type: 'context' | 'memory' | 'handoff';
  status: string;
  title: string | null;
  content: string;
  tags: string | null;
  created_at: number;
  updated_at: number;
}
