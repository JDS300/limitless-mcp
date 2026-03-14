import { z } from 'zod';
import { getPinnedEntries } from '../db/queries';
import type { EntryRow } from '../db/schema';
import { deriveUserKey, safeDecrypt } from '../crypto';

export const getPinnedContextSchema = z.object({
  namespace: z.enum(['work', 'personal', 'shared']).optional(),
});

export async function getPinnedContext(
  env: Env,
  user_id: string,
  provider: string,
  namespace?: string
): Promise<EntryRow[]> {
  const rows = await getPinnedEntries(env.DB, user_id, namespace);
  const key = await deriveUserKey(`${provider}:${user_id}`, env.SERVER_ENCRYPTION_SECRET);
  return Promise.all(rows.map(async (r) => ({ ...r, content: await safeDecrypt(r.content, key) })));
}
