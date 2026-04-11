import { storeEntry } from '../tools/store';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleBulkImport(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  let body: any;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const entries = body.entries;
  if (!Array.isArray(entries)) {
    return json({ error: 'Body must contain an "entries" array' }, 400);
  }

  const results: { index: number; id?: string; error?: string }[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    try {
      // Admin auth currently only supports Google OAuth.
      // When multi-provider support is added, extract provider from admin token claims.
      const result = await storeEntry(env, userId, 'google', entries[i]);
      results.push({ index: i, id: result.id });
      succeeded++;
    } catch (err) {
      results.push({ index: i, error: String(err) });
      failed++;
    }
  }

  return json({ total: entries.length, succeeded, failed, results });
}
