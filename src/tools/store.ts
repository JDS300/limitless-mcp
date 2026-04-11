import { z } from 'zod';
import { generateEmbedding } from '../embeddings';
import { insertEntry } from '../db/queries';
import { insertRelationship } from '../db/relationships';
import { deriveUserKey, encryptContent } from '../crypto';

export const storeEntrySchema = z.object({
  type: z.enum(['identity', 'rules', 'catalog', 'framework', 'decision', 'project', 'handoff', 'resource', 'memory']),
  title: z.string().optional(),
  content: z.string().min(1),
  tags: z.string().optional(),
  namespace: z.enum(['work', 'personal', 'shared']).optional(),
  pinned: z.boolean().optional(),
  resource_name: z.string().optional(),
  resource_location: z.string().optional(),
  supersedes: z.string().uuid().optional(),
  relationships: z.array(z.object({
    target_id: z.string().uuid(),
    rel_type: z.string(),
    label: z.string().optional(),
  })).optional(),
});

export async function storeEntry(
  env: Env,
  user_id: string,
  provider: string,
  input: z.infer<typeof storeEntrySchema>
): Promise<{ id: string; message: string }> {
  const id = crypto.randomUUID();

  // Determine initial status
  const status = input.type === 'handoff' ? 'needs_action' : 'active';

  // Generate embedding on plaintext (vectors must represent real semantics)
  const embedding = await generateEmbedding(env.AI, input.content);

  // Encrypt content before storing in D1
  const key = await deriveUserKey(`${provider}:${user_id}`, env.SERVER_ENCRYPTION_SECRET);
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
    namespace: input.namespace ?? null,
    pinned: input.pinned ? 1 : 0,
    resource_name: input.resource_name ?? null,
    resource_location: input.resource_location ?? null,
    supersedes: input.supersedes ?? null,
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
          ...(input.namespace ? { namespace: input.namespace } : {}),
        },
      },
    ]);
  } catch (err) {
    await env.DB.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?')
      .bind(id, user_id)
      .run();
    throw new Error(`Failed to store vector embedding; entry rolled back. ${String(err)}`);
  }

  // Create relationships if provided
  if (input.relationships && input.relationships.length > 0) {
    for (const rel of input.relationships) {
      await insertRelationship(env.DB, {
        source_id: id,
        target_id: rel.target_id,
        rel_type: rel.rel_type,
        label: rel.label ?? null,
      });
    }
  }

  return {
    id,
    message: `Stored ${input.type} entry with id ${id}`,
  };
}
