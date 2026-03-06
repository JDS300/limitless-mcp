import { z } from 'zod';
import { generateEmbedding } from '../embeddings';
import { getEntriesByIds } from '../db/queries';
import type { EntryRow } from '../db/schema';

export const searchMemorySchema = z.object({
  query: z.string().min(1),
  type: z.enum(['context', 'memory', 'handoff']).optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export async function searchMemory(
  env: Env,
  user_id: string,
  input: z.infer<typeof searchMemorySchema>
): Promise<EntryRow[]> {
  // Generate embedding for the query
  const embedding = await generateEmbedding(env.AI, input.query);

  // Build Vectorize filter
  const filter: VectorizeVectorMetadataFilter = { user_id };
  if (input.type) {
    filter['type'] = input.type;
  }

  // Query Vectorize
  const vectorResults = await env.VECTORIZE.query(embedding, {
    topK: input.limit,
    filter,
    returnMetadata: 'none',
  });

  if (!vectorResults.matches || vectorResults.matches.length === 0) {
    return [];
  }

  const ids = vectorResults.matches.map((m) => m.id);

  // Fetch full entries from D1 (also re-checks user_id)
  return getEntriesByIds(env.DB, ids, user_id);
}
