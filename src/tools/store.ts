import { z } from 'zod';
import { generateEmbedding } from '../embeddings';
import { insertEntry } from '../db/queries';
import { deriveUserKey, encryptContent } from '../crypto';

export const storeEntrySchema = z.object({
  type: z.enum(['context', 'memory', 'handoff']),
  title: z.string().optional(),
  content: z.string().min(1),
  tags: z.string().optional(),
});

export async function storeEntry(
  env: Env,
  user_id: string,
  input: z.infer<typeof storeEntrySchema>
): Promise<{ id: string; message: string }> {
  const id = crypto.randomUUID();

  // Determine initial status
  const status = input.type === 'handoff' ? 'needs_action' : 'active';

  // Generate embedding on plaintext (vectors must represent real semantics)
  const embedding = await generateEmbedding(env.AI, input.content);

  // Encrypt content before storing in D1
  const key = await deriveUserKey(`google:${user_id}`, env.SERVER_ENCRYPTION_SECRET);
  const encryptedContent = await encryptContent(input.content, key);

  // Insert into D1
  await insertEntry(env.DB, {
    id,
    user_id,
    type: input.type,
    status,
    title: input.title ?? null,
    content: encryptedContent,
    tags: input.tags ?? null,
    namespace: null,
    pinned: 0,
    resource_name: null,
    resource_location: null,
  });

  // Upsert vector into Vectorize — if this fails, delete the D1 row to keep stores in sync
  try {
    await env.VECTORIZE.upsert([
      {
        id,
        values: embedding,
        metadata: {
          user_id,
          type: input.type,
          status,
        },
      },
    ]);
  } catch (err) {
    await env.DB.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?')
      .bind(id, user_id)
      .run();
    throw new Error(`Failed to store vector embedding; entry rolled back. ${String(err)}`);
  }

  return {
    id,
    message: `Stored ${input.type} entry with id ${id}`,
  };
}
