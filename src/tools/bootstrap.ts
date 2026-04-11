import { z } from 'zod';
import { deriveUserKey, safeDecrypt } from '../crypto';
import type { EntryRow } from '../db/schema';

export const bootstrapSessionSchema = z.object({
  namespace: z.enum(['work', 'personal', 'shared']),
});

interface BootstrapSection {
  domain: string;
  entries: EntryRow[];
}

interface BootstrapResult {
  namespace: string;
  sections: BootstrapSection[];
}

const BOOTSTRAP_DOMAINS = ['identity', 'rules', 'project', 'handoff', 'decision'] as const;

export async function bootstrapSession(
  env: Env,
  user_id: string,
  provider: string,
  input: z.infer<typeof bootstrapSessionSchema>
): Promise<BootstrapResult> {
  const namespace = input.namespace;
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const result = await env.DB.prepare(
    `SELECT * FROM entries
     WHERE user_id = ?
       AND (namespace = ? OR namespace = 'shared')
       AND (
         pinned = 1
         OR (type = 'handoff' AND status = 'needs_action')
         OR (type = 'decision' AND (pinned = 1 OR updated_at > ?))
       )
     ORDER BY type ASC, updated_at DESC`
  )
    .bind(user_id, namespace, thirtyDaysAgo)
    .all<EntryRow>();

  const key = await deriveUserKey(`${provider}:${user_id}`, env.SERVER_ENCRYPTION_SECRET);
  const entries = await Promise.all(
    result.results.map(async (r) => ({
      ...r,
      content: await safeDecrypt(r.content, key),
    }))
  );

  const byType = new Map<string, EntryRow[]>();
  for (const entry of entries) {
    const list = byType.get(entry.type) ?? [];
    list.push(entry);
    byType.set(entry.type, list);
  }

  const sections: BootstrapSection[] = [];
  for (const domain of BOOTSTRAP_DOMAINS) {
    const domainEntries = byType.get(domain);
    if (domainEntries?.length) {
      sections.push({ domain, entries: domainEntries });
    }
  }

  return { namespace, sections };
}
