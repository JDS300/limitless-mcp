import type { RelationshipRow } from './schema';

export async function insertRelationship(
  db: D1Database,
  rel: {
    source_id: string;
    target_id: string;
    rel_type: string;
    label?: string | null;
  }
): Promise<RelationshipRow> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO relationships (id, source_id, target_id, rel_type, label, valid_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, rel.source_id, rel.target_id, rel.rel_type, rel.label ?? null, now, now)
    .run();
  return { id, ...rel, label: rel.label ?? null, valid_from: now, valid_to: null, created_at: now };
}

export async function getRelationshipsByEntry(
  db: D1Database,
  entryId: string,
  opts?: { includeExpired?: boolean; relType?: string }
): Promise<RelationshipRow[]> {
  const conditions = ['(source_id = ? OR target_id = ?)'];
  const binds: unknown[] = [entryId, entryId];

  if (!opts?.includeExpired) {
    conditions.push('valid_to IS NULL');
  }
  if (opts?.relType) {
    conditions.push('rel_type = ?');
    binds.push(opts.relType);
  }

  const result = await db
    .prepare(
      `SELECT * FROM relationships WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`
    )
    .bind(...binds)
    .all<RelationshipRow>();
  return result.results;
}

export async function expireRelationship(
  db: D1Database,
  id: string
): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE relationships SET valid_to = ? WHERE id = ?`)
    .bind(Date.now(), id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteRelationshipsByEntry(
  db: D1Database,
  entryId: string
): Promise<void> {
  await db
    .prepare(`DELETE FROM relationships WHERE source_id = ? OR target_id = ?`)
    .bind(entryId, entryId)
    .run();
}
