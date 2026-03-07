import { z } from 'zod';
import { updateEntry } from '../db/queries';
import { generateEmbedding } from '../embeddings';
import type { EntryRow } from '../db/schema';
import { deriveUserKey, encryptContent, safeDecrypt } from '../crypto';

export const updateEntrySchema = z.object({
  id: z.string().uuid(),
  tags: z.string().optional(),
  content: z.string().min(1).optional(),
});

export async function updateEntryTool(
  env: Env,
  user_id: string,
  input: z.infer<typeof updateEntrySchema>
): Promise<{ success: boolean; entry: EntryRow | null; message: string }> {
  const fields: { tags?: string | null; content?: string } = {};
  if ('tags' in input) fields.tags = input.tags ?? null;
  if (input.content !== undefined) fields.content = input.content;

  if (Object.keys(fields).length === 0) {
    return { success: false, entry: null, message: 'No fields to update' };
  }

  const key = await deriveUserKey(`google:${user_id}`, env.SERVER_ENCRYPTION_SECRET);

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
