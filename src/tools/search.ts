import { z } from 'zod';
import { generateEmbedding } from '../embeddings';
import { getEntriesByIds } from '../db/queries';
import type { EntryRow } from '../db/schema';
import { deriveUserKey, safeDecrypt } from '../crypto';

export const searchMemorySchema = z.object({
  query: z.string().min(1),
  type: z.enum(['identity', 'rules', 'catalog', 'framework', 'decision', 'project', 'handoff', 'resource', 'memory']).optional(),
  limit: z.number().int().min(1).max(20).default(5),
  namespace: z.enum(['work', 'personal', 'shared']).optional(),
});

export async function searchMemory(
  env: Env,
  user_id: string,
  provider: string,
  input: z.infer<typeof searchMemorySchema>
): Promise<{ results: EntryRow[]; _debug: { vectorize_matches: number; user_id: string; filter: VectorizeVectorMetadataFilter } }> {
  // Generate embedding for the query
  const embedding = await generateEmbedding(env.AI, input.query);

  // Build Vectorize filter
  const filter: VectorizeVectorMetadataFilter = { user_id };
  if (input.type) {
    filter['type'] = input.type;
  }
  if (input.namespace) {
    filter['namespace'] = { $in: [input.namespace, 'shared'] } as any;
  }

  // Query Vectorize
  const vectorResults = await env.VECTORIZE.query(embedding, {
    topK: input.limit,
    filter,
    returnMetadata: 'none',
  });

  const vectorize_matches = vectorResults.matches?.length ?? 0;

  if (vectorize_matches === 0) {
    return { results: [], _debug: { vectorize_matches, user_id, filter } };
  }

  const ids = vectorResults.matches.map((m) => m.id);

  // Fetch full entries from D1 (also re-checks user_id)
  const results = await getEntriesByIds(env.DB, ids, user_id);

  // Decrypt content before returning
  const key = await deriveUserKey(`${provider}:${user_id}`, env.SERVER_ENCRYPTION_SECRET);
  const decrypted = await Promise.all(
    results.map(async (r) => ({ ...r, content: await safeDecrypt(r.content, key) }))
  );

  return { results: decrypted, _debug: { vectorize_matches, user_id, filter } };
}
