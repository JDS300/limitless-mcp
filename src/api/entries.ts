import { extractAdminUserId } from './auth';
import { listEntries, getEntryById, updateEntry, deleteEntry } from '../db/queries';
import { deriveUserKey, encryptContent, safeDecrypt } from '../crypto';
import { generateEmbedding } from '../embeddings';
import type { EntryRow } from '../db/schema';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Admin uses provider='google' (only provider supported in V2)
async function getKey(userId: string, env: Env) {
  return deriveUserKey(`google:${userId}`, env.SERVER_ENCRYPTION_SECRET);
}

async function decryptRow(row: EntryRow, key: CryptoKey): Promise<EntryRow> {
  return { ...row, content: await safeDecrypt(row.content, key) };
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const userId = await extractAdminUserId(request, env.SERVER_ENCRYPTION_SECRET);
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const url   = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'entries', id?]
  const id    = parts[2];

  // Route /api/relationships and /api/relationships/:id
  if (parts[1] === 'relationships') {
    const { handleRelationshipsRequest } = await import('./relationships');
    return handleRelationshipsRequest(request, env, userId, parts[2]);
  }

  // Route /api/entries/bulk
  if (parts[2] === 'bulk' && request.method === 'POST') {
    const { handleBulkImport } = await import('./bulk');
    return handleBulkImport(request, env, userId);
  }

  // Route /api/entries/:id/relationships
  if (parts[3] === 'relationships' && id) {
    const { handleRelationshipsRequest } = await import('./relationships');
    return handleRelationshipsRequest(request, env, userId, undefined, id);
  }

  if (request.method === 'GET'    && !id)  return handleList(url, userId, env);
  if (request.method === 'GET'    &&  id)  return handleGetOne(id, userId, env);
  if (request.method === 'PATCH'  &&  id)  return handlePatch(request, id, userId, env);
  if (request.method === 'DELETE' &&  id)  return handleDelete(id, userId, env);
  return json({ error: 'Method not allowed' }, 405);
}

async function handleList(url: URL, userId: string, env: Env): Promise<Response> {
  const p = url.searchParams;
  const nsParam = p.get('namespace');

  // URL query params are strings. "null" is the sentinel for SQL IS NULL.
  let namespace: string | null | undefined = undefined;
  if (nsParam === 'null')  namespace = null;
  else if (nsParam)        namespace = nsParam;

  const filters = {
    ...(namespace !== undefined ? { namespace } : {}),
    ...(p.get('type')   ? { type:   p.get('type')! }   : {}),
    ...(p.get('status') ? { status: p.get('status')! } : {}),
    ...(p.get('pinned') ? { pinned: p.get('pinned') === 'true' } : {}),
    limit:  Math.min(parseInt(p.get('limit')  ?? '50', 10), 200),
    offset: parseInt(p.get('offset') ?? '0', 10),
  };

  const rows = await listEntries(env.DB, userId, filters);
  const key  = await getKey(userId, env);
  const results = await Promise.all(rows.map((r) => decryptRow(r, key)));
  return json({ results });
}

async function handleGetOne(id: string, userId: string, env: Env): Promise<Response> {
  const row = await getEntryById(env.DB, id, userId);
  if (!row) return json({ error: 'Not found' }, 404);
  const key = await getKey(userId, env);
  return json(await decryptRow(row, key));
}

async function handlePatch(request: Request, id: string, userId: string, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const fields: Parameters<typeof updateEntry>[3] = {};
  // JSON null is valid for nullable fields (clears the value in D1)
  if ('title'        in body) fields.title        = body.title        as string | null;
  if ('tags'         in body) fields.tags         = body.tags         as string | null;
  if ('namespace'    in body) fields.namespace    = body.namespace    as string | null;
  if ('pinned'       in body) fields.pinned       = body.pinned ? 1 : 0;
  if ('confirmed_at' in body) fields.confirmed_at = body.confirmed_at as number | null;

  if ('content' in body && typeof body.content === 'string') {
    const key = await getKey(userId, env);
    fields.content = await encryptContent(body.content, key);
  }

  if (Object.keys(fields).length === 0) return json({ error: 'No fields to update' }, 400);

  const entry = await updateEntry(env.DB, id, userId, fields);
  if (!entry) return json({ error: 'Not found' }, 404);

  if ('content' in body && typeof body.content === 'string') {
    const embedding = await generateEmbedding(env.AI, body.content);
    await env.VECTORIZE.upsert([{
      id,
      values: embedding,
      metadata: { user_id: userId, type: entry.type, status: entry.status, ...(entry.namespace ? { namespace: entry.namespace } : {}) },
    }]);
  }

  const key = await getKey(userId, env);
  return json(await decryptRow(entry, key));
}

async function handleDelete(id: string, userId: string, env: Env): Promise<Response> {
  const deleted = await deleteEntry(env.DB, id, userId);
  if (!deleted) return json({ error: 'Not found' }, 404);
  try { await env.VECTORIZE.deleteByIds([id]); } catch { /* best-effort */ }
  return json({ success: true, message: `Entry ${id} deleted` });
}
