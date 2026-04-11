import type { EntryRow } from './schema';

export async function upsertUser(
  db: D1Database,
  user: { id: string; email: string; name: string; provider: string }
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, email, name, provider, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_seen = excluded.last_seen,
         name = excluded.name,
         provider = excluded.provider`
    )
    .bind(user.id, user.email, user.name, user.provider, now, now)
    .run();
}

export async function insertEntry(
  db: D1Database,
  entry: {
    id: string;
    user_id: string;
    type: string;
    status: 'active' | 'needs_action' | 'actioned';
    title: string | null;
    content: string;
    tags: string | null;
    namespace: string | null;
    pinned: number;
    resource_name: string | null;
    resource_location: string | null;
    supersedes: string | null;
  }
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO entries
         (id, user_id, type, status, title, content, tags,
          namespace, pinned, resource_name, resource_location,
          supersedes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entry.id, entry.user_id, entry.type, entry.status,
      entry.title, entry.content, entry.tags,
      entry.namespace, entry.pinned,
      entry.resource_name, entry.resource_location,
      entry.supersedes,
      now, now
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
  // Re-sort to preserve the caller's order (e.g. Vectorize relevance rank).
  // SQL IN (...) does not guarantee ordering.
  const byId = new Map(result.results.map((row) => [row.id, row]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export async function getActiveHandoffs(
  db: D1Database,
  user_id: string,
  namespace?: string
): Promise<EntryRow[]> {
  if (namespace) {
    const result = await db
      .prepare(
        `SELECT * FROM entries
         WHERE user_id = ? AND type = 'handoff' AND status = 'needs_action'
           AND (namespace = ? OR namespace = 'shared')
         ORDER BY created_at DESC`
      )
      .bind(user_id, namespace)
      .all<EntryRow>();
    return result.results;
  }
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

export async function updateEntry(
  db: D1Database,
  id: string,
  user_id: string,
  fields: {
    title?: string | null;
    tags?: string | null;
    content?: string;
    namespace?: string | null;
    pinned?: number;
    confirmed_at?: number | null;
    supersedes?: string | null;
  }
): Promise<EntryRow | null> {
  const sets: string[] = ['updated_at = ?'];
  const binds: unknown[] = [Date.now()];

  if ('title'        in fields) { sets.push('title = ?');        binds.push(fields.title ?? null); }
  if ('tags'         in fields) { sets.push('tags = ?');         binds.push(fields.tags ?? null); }
  if (fields.content !== undefined)  { sets.push('content = ?'); binds.push(fields.content); }
  if ('namespace'    in fields) { sets.push('namespace = ?');    binds.push(fields.namespace ?? null); }
  if (fields.pinned  !== undefined)  { sets.push('pinned = ?');  binds.push(fields.pinned); }
  if ('confirmed_at' in fields) { sets.push('confirmed_at = ?'); binds.push(fields.confirmed_at ?? null); }
  if ('supersedes'   in fields) { sets.push('supersedes = ?');   binds.push(fields.supersedes ?? null); }

  binds.push(id, user_id);
  return db
    .prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`)
    .bind(...binds)
    .first<EntryRow>();
}

export async function getEntryById(
  db: D1Database,
  id: string,
  user_id: string
): Promise<EntryRow | null> {
  return db
    .prepare(`SELECT * FROM entries WHERE id = ? AND user_id = ?`)
    .bind(id, user_id)
    .first<EntryRow>();
}

export async function getPinnedEntries(
  db: D1Database,
  user_id: string,
  namespace?: string
): Promise<EntryRow[]> {
  if (namespace) {
    const result = await db
      .prepare(
        `SELECT * FROM entries
         WHERE user_id = ? AND pinned = 1
           AND (namespace = ? OR namespace = 'shared')
         ORDER BY updated_at DESC`
      )
      .bind(user_id, namespace)
      .all<EntryRow>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT * FROM entries WHERE user_id = ? AND pinned = 1 ORDER BY updated_at DESC`)
    .bind(user_id)
    .all<EntryRow>();
  return result.results;
}

export async function getResourceEntries(
  db: D1Database,
  user_id: string,
  opts: { name?: string; tag?: string }
): Promise<EntryRow[]> {
  if (opts.name) {
    const result = await db
      .prepare(
        `SELECT * FROM entries
         WHERE user_id = ? AND type = 'resource' AND resource_name = ?`
      )
      .bind(user_id, opts.name)
      .all<EntryRow>();
    return result.results;
  }
  // tag: substring match against comma-separated tags field
  // Known limitation: may return partial-word false positives on small datasets
  const result = await db
    .prepare(
      `SELECT * FROM entries
       WHERE user_id = ? AND type = 'resource' AND tags LIKE ?
       ORDER BY resource_name ASC`
    )
    .bind(user_id, `%${opts.tag}%`)
    .all<EntryRow>();
  return result.results;
}

export async function listEntries(
  db: D1Database,
  user_id: string,
  filters: {
    namespace?: string | null;  // null means IS NULL (unnamespaced)
    type?: string;
    pinned?: boolean;
    status?: string;
    limit: number;
    offset: number;
  }
): Promise<EntryRow[]> {
  const conditions: string[] = ['user_id = ?'];
  const binds: unknown[] = [user_id];

  if ('namespace' in filters) {
    if (filters.namespace === null) {
      conditions.push('namespace IS NULL');
    } else {
      conditions.push('namespace = ?');
      binds.push(filters.namespace);
    }
  }
  if (filters.type)             { conditions.push('type = ?');   binds.push(filters.type); }
  if (filters.pinned !== undefined) {
    conditions.push('pinned = ?'); binds.push(filters.pinned ? 1 : 0);
  }
  if (filters.status)           { conditions.push('status = ?'); binds.push(filters.status); }

  binds.push(filters.limit, filters.offset);
  const result = await db
    .prepare(
      `SELECT * FROM entries WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...binds)
    .all<EntryRow>();
  return result.results;
}

export async function deleteEntry(
  db: D1Database,
  id: string,
  user_id: string
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM entries WHERE id = ? AND user_id = ?`)
    .bind(id, user_id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
