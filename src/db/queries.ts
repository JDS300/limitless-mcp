import type { EntryRow } from './schema';

export async function upsertUser(
  db: D1Database,
  user: { id: string; email: string; name: string }
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, email, name, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, name = excluded.name`
    )
    .bind(user.id, user.email, user.name, now, now)
    .run();
}

export async function insertEntry(
  db: D1Database,
  entry: {
    id: string;
    user_id: string;
    type: 'context' | 'memory' | 'handoff';
    status: string;
    title: string | null;
    content: string;
    tags: string | null;
  }
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO entries (id, user_id, type, status, title, content, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entry.id,
      entry.user_id,
      entry.type,
      entry.status,
      entry.title,
      entry.content,
      entry.tags,
      now,
      now
    )
    .run();
}

export async function getEntriesByIds(
  db: D1Database,
  ids: string[],
  user_id: string
): Promise<EntryRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT * FROM entries WHERE id IN (${placeholders}) AND user_id = ? AND status != 'actioned'`
    )
    .bind(...ids, user_id)
    .all<EntryRow>();
  return result.results;
}

export async function getActiveHandoffs(
  db: D1Database,
  user_id: string
): Promise<EntryRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM entries
       WHERE user_id = ? AND type = 'handoff' AND status = 'needs_action'
       ORDER BY created_at DESC`
    )
    .bind(user_id)
    .all<EntryRow>();
  return result.results;
}

export async function archiveHandoff(
  db: D1Database,
  id: string,
  user_id: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE entries SET status = 'actioned', updated_at = ?
       WHERE id = ? AND user_id = ? AND type = 'handoff'`
    )
    .bind(Date.now(), id, user_id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
