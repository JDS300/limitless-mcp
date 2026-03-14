import { z } from 'zod';
import { getActiveHandoffs, archiveHandoff, getEntryById } from '../db/queries';
import type { EntryRow } from '../db/schema';
import { deriveUserKey, safeDecrypt } from '../crypto';

export const getHandoffsSchema = z.object({
  namespace: z.enum(['work', 'personal', 'shared']).optional(),
});

export async function getHandoffs(
  env: Env,
  user_id: string,
  provider: string,
  namespace?: string
): Promise<EntryRow[]> {
  const rows = await getActiveHandoffs(env.DB, user_id, namespace);
  const key = await deriveUserKey(`${provider}:${user_id}`, env.SERVER_ENCRYPTION_SECRET);
  return Promise.all(rows.map(async (r) => ({ ...r, content: await safeDecrypt(r.content, key) })));
}

export const archiveHandoffSchema = z.object({
  id: z.string().uuid(),
});

export async function archiveHandoffEntry(
  env: Env,
  user_id: string,
  provider: string,
  input: z.infer<typeof archiveHandoffSchema>
): Promise<{ success: boolean; message: string }> {
  // Update D1
  const updated = await archiveHandoff(env.DB, input.id, user_id);

  if (!updated) {
    return {
      success: false,
      message: `No active handoff found with id ${input.id} for this user`,
    };
  }

  // Fetch entry to carry its namespace forward in Vectorize metadata
  const entry = await getEntryById(env.DB, input.id, user_id);

  // Update vector metadata in Vectorize
  await env.VECTORIZE.upsert([
    {
      id: input.id,
      values: new Array(768).fill(0), // values required by Vectorize API; zeros are fine for metadata-only updates
      metadata: {
        user_id,
        type: 'handoff',
        status: 'actioned',
        namespace: entry?.namespace ?? null, // carry namespace forward
      },
    },
  ]);

  return {
    success: true,
    message: `Handoff ${input.id} archived`,
  };
}
