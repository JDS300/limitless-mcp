import { z } from 'zod';
import { updateEntry } from '../db/queries';
import { generateEmbedding } from '../embeddings';
import type { EntryRow } from '../db/schema';
import { deriveUserKey, encryptContent, safeDecrypt } from '../crypto';

export const updateEntrySchema = z.object({
  id: z.string().uuid(),
  title: z.string().optional(),
  tags: z.string().optional(),
  content: z.string().min(1).optional(),
  namespace: z.enum(['work', 'personal', 'shared']).nullable().optional(),
  pinned: z.boolean().optional(),
  confirmed_at: z.number().optional(),
});

export async function updateEntryTool(
  env: Env,
  user_id: string,
  provider: string,
  input: z.infer<typeof updateEntrySchema>
): Promise<{ success: boolean; entry: EntryRow | null; message: string }> {
  const fields: Parameters<typeof updateEntry>[3] = {};
  if ('title'        in input) fields.title        = input.title ?? null;
  if ('tags'         in input) fields.tags         = input.tags ?? null;
  if (input.content  !== undefined) fields.content = input.content;
  if ('namespace'    in input) fields.namespace    = input.namespace ?? null;
  if (input.pinned   !== undefined) fields.pinned  = input.pinned ? 1 : 0;
  if (input.confirmed_at !== undefined) fields.confirmed_at = input.confirmed_at;

  if (Object.keys(fields).length === 0) {
    return { success: false, entry: null, message: 'No fields to update' };
  }

  const key = await deriveUserKey(`${provider}:${user_id}`, env.SERVER_ENCRYPTION_SECRET);

  // Encrypt content before storing
  if (input.content !== undefined) fields.content = await encryptContent(input.content, key);

  // Update D1
  let entry = await updateEntry(env.DB, input.id, user_id, fields);

  if (!entry) {
    return {
      success: false,
      entry: null,
      message: `No entry found with id ${input.id} for this user`,
    };
  }

  // Re-embed in Vectorize only if content changed
  if (input.content !== undefined) {
    try {
      const embedding = await generateEmbedding(env.AI, input.content);
      await env.VECTORIZE.upsert([
        {
          id: input.id,
          values: embedding,
          metadata: {
            user_id,
            type: entry.type,
            status: entry.status,
            namespace: entry.namespace ?? null,
          },
        },
      ]);
    } catch (err) {
      throw new Error(
        `Entry ${input.id} updated in D1 but vector re-embedding failed: ${String(err)}`
      );
    }
  }

  // Decrypt content before returning to caller
  if (entry) entry = { ...entry, content: await safeDecrypt(entry.content, key) };

  return {
    success: true,
    entry,
    message: `Entry ${input.id} updated`,
  };
}
