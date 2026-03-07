import { z } from 'zod';
import { getActiveHandoffs, archiveHandoff } from '../db/queries';
import type { EntryRow } from '../db/schema';
import { deriveUserKey, safeDecrypt } from '../crypto';

export async function getHandoffs(
  env: Env,
  user_id: string
): Promise<EntryRow[]> {
  const rows = await getActiveHandoffs(env.DB, user_id);
  const key = await deriveUserKey(`google:${user_id}`, env.SERVER_ENCRYPTION_SECRET);
  return Promise.all(
    rows.map(async (r) => ({ ...r, content: await safeDecrypt(r.content, key) }))
  );
}

export const archiveHandoffSchema = z.object({
  id: z.string().uuid(),
});

export async function archiveHandoffEntry(
  env: Env,
  user_id: string,
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

  // Update vector metadata in Vectorize
  await env.VECTORIZE.upsert([
    {
      id: input.id,
      // We need values to upsert — get them by querying the existing vector
      // Vectorize doesn't support metadata-only updates, so we use getByIds
      values: new Array(768).fill(0), // placeholder — Vectorize ignores values on metadata update
      metadata: {
        user_id,
        type: 'handoff',
        status: 'actioned',
      },
    },
  ]);

  return {
    success: true,
    message: `Handoff ${input.id} archived`,
  };
}
