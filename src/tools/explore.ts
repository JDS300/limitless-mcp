import { z } from 'zod';
import { getEntryById } from '../db/queries';
import { getRelationshipsByEntry } from '../db/relationships';
import { deriveUserKey, safeDecrypt } from '../crypto';
import type { EntryRow, RelationshipRow } from '../db/schema';

export const exploreContextSchema = z.object({
  entry_id: z.string().uuid(),
  rel_type: z.string().optional(),
  depth: z.number().int().min(1).max(3).default(1),
  namespace: z.enum(['work', 'personal', 'shared']).optional(),
  cross_namespace: z.enum(['work', 'personal', 'shared']).optional(),
  include_expired: z.boolean().default(false),
});

interface RelatedEntry {
  entry: EntryRow;
  relationship: RelationshipRow;
  direction: 'outgoing' | 'incoming';
}

interface ExploreResult {
  root: EntryRow;
  related: RelatedEntry[];
}

export async function exploreContext(
  env: Env,
  user_id: string,
  provider: string,
  input: z.infer<typeof exploreContextSchema>
): Promise<ExploreResult> {
  const root = await getEntryById(env.DB, input.entry_id, user_id);
  if (!root) {
    throw new Error(`Entry ${input.entry_id} not found`);
  }

  const key = await deriveUserKey(`${provider}:${user_id}`, env.SERVER_ENCRYPTION_SECRET);

  // Determine allowed namespaces for filtering
  const allowedNamespaces = new Set<string | null>(['shared']);
  if (input.namespace) allowedNamespaces.add(input.namespace);
  if (input.cross_namespace) allowedNamespaces.add(input.cross_namespace);
  const filterByNamespace = !!(input.namespace || input.cross_namespace);

  // Walk the graph to requested depth
  const visited = new Set<string>([input.entry_id]);
  const allRelated: RelatedEntry[] = [];
  let frontier = [input.entry_id];

  for (let d = 0; d < input.depth; d++) {
    const nextFrontier: string[] = [];

    for (const entryId of frontier) {
      const rels = await getRelationshipsByEntry(env.DB, entryId, {
        includeExpired: input.include_expired,
        relType: input.rel_type,
      });

      for (const rel of rels) {
        const otherId = rel.source_id === entryId ? rel.target_id : rel.source_id;
        const direction = rel.source_id === entryId ? 'outgoing' : 'incoming';

        if (visited.has(otherId)) continue;
        visited.add(otherId);

        const entry = await getEntryById(env.DB, otherId, user_id);
        if (!entry) continue;

        // Namespace filtering
        if (filterByNamespace && !allowedNamespaces.has(entry.namespace)) continue;

        allRelated.push({ entry, relationship: rel, direction });
        nextFrontier.push(otherId);
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  // Decrypt all content
  const decryptedRoot = { ...root, content: await safeDecrypt(root.content, key) };
  const decryptedRelated = await Promise.all(
    allRelated.map(async (r) => ({
      ...r,
      entry: { ...r.entry, content: await safeDecrypt(r.entry.content, key) },
    }))
  );

  return { root: decryptedRoot, related: decryptedRelated };
}
