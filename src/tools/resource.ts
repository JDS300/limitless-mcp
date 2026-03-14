import { z } from 'zod';
import { getResourceEntries } from '../db/queries';
import type { EntryRow } from '../db/schema';
import { deriveUserKey, safeDecrypt } from '../crypto';

export const getResourceSchema = z.object({
  name: z.string().optional(),
  tag: z.string().optional(),
});

export async function getResource(
  env: Env,
  user_id: string,
  provider: string,
  input: z.infer<typeof getResourceSchema>
): Promise<EntryRow[] | { success: false; message: string }> {
  if (!input.name && !input.tag) {
    return { success: false, message: "At least one of 'name' or 'tag' is required" };
  }
  const rows = await getResourceEntries(env.DB, user_id, { name: input.name, tag: input.tag });
  const key = await deriveUserKey(`${provider}:${user_id}`, env.SERVER_ENCRYPTION_SECRET);
  return Promise.all(rows.map(async (r) => ({ ...r, content: await safeDecrypt(r.content, key) })));
}
