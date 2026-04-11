import {
  getRelationshipsByEntry,
  insertRelationship,
  expireRelationship,
} from '../db/relationships';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleRelationshipsRequest(
  request: Request,
  env: Env,
  userId: string,
  relId?: string,
  entryId?: string,
): Promise<Response> {
  // GET /api/entries/:id/relationships
  if (request.method === 'GET' && entryId) {
    const url = new URL(request.url);
    const includeExpired = url.searchParams.get('include_expired') === 'true';
    const relType = url.searchParams.get('rel_type') ?? undefined;
    const rels = await getRelationshipsByEntry(env.DB, entryId, { includeExpired, relType });
    return json({ results: rels });
  }

  // POST /api/relationships
  if (request.method === 'POST' && !relId) {
    let body: Record<string, unknown>;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400); }

    const { source_id, target_id, rel_type, label } = body as any;
    if (!source_id || !target_id || !rel_type) {
      return json({ error: 'source_id, target_id, and rel_type are required' }, 400);
    }

    const rel = await insertRelationship(env.DB, { source_id, target_id, rel_type, label });
    return json(rel);
  }

  // PATCH /api/relationships/:id (expire)
  if (request.method === 'PATCH' && relId) {
    const expired = await expireRelationship(env.DB, relId);
    if (!expired) return json({ error: 'Not found' }, 404);
    return json({ success: true, message: `Relationship ${relId} expired` });
  }

  return json({ error: 'Method not allowed' }, 405);
}
