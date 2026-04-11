# Limitless V3 — Context Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve limitless-mcp from a supplementary memory store into the primary AI-agnostic knowledge layer with domain-typed entries, a relationship graph, progressive bootstrap loading, and hard namespace enforcement.

**Architecture:** Extend the existing Cloudflare Workers stack (D1 + Vectorize + Workers AI) with a new `relationships` table, expanded entry type enum (9 domains), a `bootstrap_session` MCP tool that aggregates pinned context by domain, and an `explore_context` tool that walks the relationship graph. Namespace becomes required on writes.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), Vectorize, Workers AI, Zod, Vitest, MCP SDK

**Spec:** `docs/superpowers/specs/2026-04-11-limitless-v3-context-engine-design.md`

---

### Task 1: Schema Migration — Expand Type Enum and Add Relationships Table

**Files:**
- Create: `migrations/0003_v3_schema.sql`
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Write the migration SQL**

Create `migrations/0003_v3_schema.sql`:

```sql
-- V3: Context Engine
-- Expand entry types to 9 domains (type column is TEXT, no enum constraint — values enforced in app layer)
-- Add supersedes column for decision chain tracking
ALTER TABLE entries ADD COLUMN supersedes TEXT;

-- Relationships table for typed, directional, temporal edges between entries
CREATE TABLE relationships (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  rel_type    TEXT NOT NULL,
  label       TEXT,
  valid_from  INTEGER NOT NULL,
  valid_to    INTEGER,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (source_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX idx_rel_source ON relationships(source_id);
CREATE INDEX idx_rel_target ON relationships(target_id);
CREATE INDEX idx_rel_type ON relationships(rel_type);
```

- [ ] **Step 2: Update TypeScript types in `src/db/schema.ts`**

Replace the `EntryRow` type field and add `supersedes`. Add `RelationshipRow` interface:

```typescript
export interface EntryRow {
  id: string;
  user_id: string;
  type: 'identity' | 'rules' | 'catalog' | 'framework' | 'decision' | 'project' | 'handoff' | 'resource' | 'memory';
  status: 'active' | 'needs_action' | 'actioned';
  title: string | null;
  content: string;                    // encrypted at rest, decrypted in responses
  tags: string | null;
  namespace: string | null;           // 'work' | 'personal' | 'shared' | null
  pinned: number;                     // 0 | 1 (SQLite boolean)
  resource_name: string | null;       // type='resource' only
  resource_location: string | null;   // type='resource' only
  confirmed_at: number | null;        // unix ms
  supersedes: string | null;          // id of decision this one overrides
  created_at: number;
  updated_at: number;
}

export interface RelationshipRow {
  id: string;
  source_id: string;
  target_id: string;
  rel_type: string;
  label: string | null;
  valid_from: number;
  valid_to: number | null;
  created_at: number;
}
```

- [ ] **Step 3: Apply migration locally**

Run: `npx wrangler d1 migrations apply limitless-mcp --local`
Expected: Migration 0003 applied successfully

- [ ] **Step 4: Commit**

```bash
git add migrations/0003_v3_schema.sql src/db/schema.ts
git commit -m "feat(v3): schema migration — relationships table and supersedes column"
```

---

### Task 2: Relationship Query Functions

**Files:**
- Create: `src/db/relationships.ts`
- Create: `test/db/relationships.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/db/relationships.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  insertRelationship,
  getRelationshipsByEntry,
  expireRelationship,
  deleteRelationshipsByEntry,
} from '../../src/db/relationships';

const mockDb = () => {
  const rows: any[] = [];
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        all: vi.fn().mockResolvedValue({ results: rows }),
        first: vi.fn().mockResolvedValue(rows[0] ?? null),
      }),
    }),
    _rows: rows,
  };
};

describe('insertRelationship', () => {
  it('inserts a relationship with valid_from set to now', async () => {
    const db = mockDb() as any;
    const rel = await insertRelationship(db, {
      source_id: 'entry-1',
      target_id: 'entry-2',
      rel_type: 'uses_framework',
      label: 'Uses Three Patterns',
    });
    expect(rel.id).toBeDefined();
    expect(db.prepare).toHaveBeenCalled();
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO relationships');
  });
});

describe('getRelationshipsByEntry', () => {
  it('queries both source and target directions', async () => {
    const db = mockDb() as any;
    await getRelationshipsByEntry(db, 'entry-1');
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('source_id = ?');
    expect(sql).toContain('target_id = ?');
  });

  it('filters to current relationships by default', async () => {
    const db = mockDb() as any;
    await getRelationshipsByEntry(db, 'entry-1');
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('valid_to IS NULL');
  });

  it('includes expired relationships when requested', async () => {
    const db = mockDb() as any;
    await getRelationshipsByEntry(db, 'entry-1', { includeExpired: true });
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).not.toContain('valid_to IS NULL');
  });
});

describe('expireRelationship', () => {
  it('sets valid_to to current timestamp', async () => {
    const db = mockDb() as any;
    await expireRelationship(db, 'rel-1');
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('valid_to = ?');
    expect(sql).toContain('WHERE id = ?');
  });
});

describe('deleteRelationshipsByEntry', () => {
  it('deletes all relationships referencing the entry', async () => {
    const db = mockDb() as any;
    await deleteRelationshipsByEntry(db, 'entry-1');
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('DELETE FROM relationships');
    expect(sql).toContain('source_id = ?');
    expect(sql).toContain('target_id = ?');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/db/relationships.test.ts`
Expected: FAIL — module `../../src/db/relationships` not found

- [ ] **Step 3: Implement relationship query functions**

Create `src/db/relationships.ts`:

```typescript
import type { RelationshipRow } from './schema';

export async function insertRelationship(
  db: D1Database,
  rel: {
    source_id: string;
    target_id: string;
    rel_type: string;
    label?: string | null;
  }
): Promise<RelationshipRow> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO relationships (id, source_id, target_id, rel_type, label, valid_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, rel.source_id, rel.target_id, rel.rel_type, rel.label ?? null, now, now)
    .run();
  return { id, ...rel, label: rel.label ?? null, valid_from: now, valid_to: null, created_at: now };
}

export async function getRelationshipsByEntry(
  db: D1Database,
  entryId: string,
  opts?: { includeExpired?: boolean; relType?: string }
): Promise<RelationshipRow[]> {
  const conditions = ['(source_id = ? OR target_id = ?)'];
  const binds: unknown[] = [entryId, entryId];

  if (!opts?.includeExpired) {
    conditions.push('valid_to IS NULL');
  }
  if (opts?.relType) {
    conditions.push('rel_type = ?');
    binds.push(opts.relType);
  }

  const result = await db
    .prepare(
      `SELECT * FROM relationships WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`
    )
    .bind(...binds)
    .all<RelationshipRow>();
  return result.results;
}

export async function expireRelationship(
  db: D1Database,
  id: string
): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE relationships SET valid_to = ? WHERE id = ?`)
    .bind(Date.now(), id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteRelationshipsByEntry(
  db: D1Database,
  entryId: string
): Promise<void> {
  await db
    .prepare(`DELETE FROM relationships WHERE source_id = ? OR target_id = ?`)
    .bind(entryId, entryId)
    .run();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/db/relationships.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/relationships.ts test/db/relationships.test.ts
git commit -m "feat(v3): relationship query functions with tests"
```

---

### Task 3: Expand Store Entry to Accept V3 Domain Types and Relationships

**Files:**
- Modify: `src/tools/store.ts`
- Modify: `test/tools/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/tools/store.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { storeEntry } from '../../src/tools/store';

// Mock the relationships module
vi.mock('../../src/db/relationships', () => ({
  insertRelationship: vi.fn().mockResolvedValue({ id: 'rel-1' }),
}));

const mockEnv = () => ({
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({ success: true }) }),
    }),
  },
  VECTORIZE: { upsert: vi.fn().mockResolvedValue({}) },
  AI: { run: vi.fn().mockResolvedValue({ data: [new Array(768).fill(0.1)] }) },
  SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!',
});

describe('storeEntry', () => {
  it('includes namespace in Vectorize metadata', async () => {
    const env = mockEnv() as any;
    await storeEntry(env, 'user1', 'google', {
      type: 'context',
      content: 'I work at Intrust',
      namespace: 'work',
    });
    expect(env.VECTORIZE.upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        metadata: expect.objectContaining({ namespace: 'work' }),
      }),
    ]);
  });

  it('omits namespace from Vectorize metadata when not provided', async () => {
    const env = mockEnv() as any;
    await storeEntry(env, 'user1', 'google', { type: 'memory', content: 'A fact' });
    const metadata = env.VECTORIZE.upsert.mock.calls[0][0][0].metadata;
    expect(metadata).not.toHaveProperty('namespace');
  });

  it('accepts resource type with resource_name', async () => {
    const env = mockEnv() as any;
    const result = await storeEntry(env, 'user1', 'google', {
      type: 'resource',
      content: 'prompt text',
      resource_name: 'em-dash-thumbnail-prompt',
      resource_location: 'vault://Prompts/Em-Dash.md',
    });
    expect(result.id).toBeDefined();
  });

  it('accepts V3 domain types: identity, rules, catalog, framework, decision, project', async () => {
    const env = mockEnv() as any;
    for (const type of ['identity', 'rules', 'catalog', 'framework', 'decision', 'project'] as const) {
      const result = await storeEntry(env, 'user1', 'google', {
        type,
        content: `test ${type}`,
        namespace: 'work',
      });
      expect(result.id).toBeDefined();
    }
  });

  it('stores supersedes field for decision entries', async () => {
    const env = mockEnv() as any;
    await storeEntry(env, 'user1', 'google', {
      type: 'decision',
      content: 'New pricing model',
      namespace: 'work',
      supersedes: 'old-decision-id',
    });
    // Check that the bind call included supersedes
    const bindCall = env.DB.prepare.mock.calls[0][0];
    expect(bindCall).toContain('supersedes');
  });

  it('creates relationships when provided', async () => {
    const { insertRelationship } = await import('../../src/db/relationships');
    const env = mockEnv() as any;
    await storeEntry(env, 'user1', 'google', {
      type: 'project',
      content: 'Client XYZ project',
      namespace: 'work',
      relationships: [
        { target_id: 'framework-1', rel_type: 'uses_framework', label: 'Uses Three Patterns' },
      ],
    });
    expect(insertRelationship).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        rel_type: 'uses_framework',
        target_id: 'framework-1',
      })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx vitest run test/tools/store.test.ts`
Expected: FAIL — new domain types rejected by Zod enum, `supersedes` and `relationships` not in schema

- [ ] **Step 3: Update store schema and implementation**

Modify `src/tools/store.ts`:

```typescript
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
  relationships: z
    .array(
      z.object({
        target_id: z.string().uuid(),
        rel_type: z.string(),
        label: z.string().optional(),
      })
    )
    .optional(),
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
  if (input.relationships?.length) {
    for (const rel of input.relationships) {
      await insertRelationship(env.DB, {
        source_id: id,
        target_id: rel.target_id,
        rel_type: rel.rel_type,
        label: rel.label,
      });
    }
  }

  return {
    id,
    message: `Stored ${input.type} entry with id ${id}`,
  };
}
```

- [ ] **Step 4: Update `insertEntry` in `src/db/queries.ts` to include `supersedes`**

In `src/db/queries.ts`, update the `insertEntry` function signature and SQL:

Change the `entry` parameter type to include `supersedes: string | null`. Update the INSERT statement to include the `supersedes` column and bind parameter:

```typescript
export async function insertEntry(
  db: D1Database,
  entry: {
    id: string;
    user_id: string;
    type: string;
    status: 'active' | 'needs_action' | 'actioned';
    title: string | null;
    content: string;
    tags: string | null;
    namespace: string | null;
    pinned: number;
    resource_name: string | null;
    resource_location: string | null;
    supersedes: string | null;
  }
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO entries
         (id, user_id, type, status, title, content, tags,
          namespace, pinned, resource_name, resource_location,
          supersedes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entry.id, entry.user_id, entry.type, entry.status,
      entry.title, entry.content, entry.tags,
      entry.namespace, entry.pinned,
      entry.resource_name, entry.resource_location,
      entry.supersedes,
      now, now
    )
    .run();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/tools/store.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/store.ts src/db/queries.ts test/tools/store.test.ts
git commit -m "feat(v3): expand store_entry to 9 domain types with supersedes and relationships"
```

---

### Task 4: Update Search, Update, and Delete Tools for V3 Domains

**Files:**
- Modify: `src/tools/search.ts`
- Modify: `src/tools/update.ts`
- Modify: `src/tools/delete.ts`
- Modify: `test/tools/search.test.ts`
- Modify: `test/tools/update.test.ts`

- [ ] **Step 1: Write failing tests for search domain filter**

Add to `test/tools/search.test.ts`:

```typescript
describe('searchMemory domain filtering', () => {
  it('accepts V3 domain types in type filter', async () => {
    const env = makeEnv([]) as any;
    await searchMemory(env, 'u1', 'google', { query: 'pricing', type: 'catalog', limit: 5 });
    expect(env.VECTORIZE.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: expect.objectContaining({ type: 'catalog' }),
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tools/search.test.ts`
Expected: FAIL — Zod rejects 'catalog' as invalid enum value

- [ ] **Step 3: Update search schema**

In `src/tools/search.ts`, change the type enum:

```typescript
export const searchMemorySchema = z.object({
  query: z.string().min(1),
  type: z.enum(['identity', 'rules', 'catalog', 'framework', 'decision', 'project', 'handoff', 'resource', 'memory']).optional(),
  limit: z.number().int().min(1).max(20).default(5),
  namespace: z.enum(['work', 'personal', 'shared']).optional(),
});
```

- [ ] **Step 4: Update the update tool schema**

In `src/tools/update.ts`, add `supersedes` to the schema:

```typescript
export const updateEntrySchema = z.object({
  id: z.string().uuid(),
  title: z.string().optional(),
  tags: z.string().optional(),
  content: z.string().min(1).optional(),
  namespace: z.enum(['work', 'personal', 'shared']).nullable().optional(),
  pinned: z.boolean().optional(),
  confirmed_at: z.number().optional(),
  supersedes: z.string().uuid().nullable().optional(),
});
```

In the `updateEntryTool` function, add supersedes handling after the existing field mappings (after line 29):

```typescript
if ('supersedes' in input) fields.supersedes = input.supersedes ?? null;
```

And update the `fields` type alias to include `supersedes?: string | null`.

- [ ] **Step 5: Update the delete tool to cascade-delete relationships**

In `src/tools/delete.ts`, add relationship cleanup:

```typescript
import { z } from 'zod';
import { deleteEntry, getEntryById } from '../db/queries';
import { deleteRelationshipsByEntry } from '../db/relationships';

export const deleteEntrySchema = z.object({ id: z.string().uuid() });

export async function deleteEntryTool(
  env: Env,
  user_id: string,
  _provider: string,
  input: z.infer<typeof deleteEntrySchema>
): Promise<{ success: boolean; message: string }> {
  const deleted = await deleteEntry(env.DB, input.id, user_id);

  if (!deleted) {
    return {
      success: false,
      message: `No entry found with id ${input.id} for this user`,
    };
  }

  // Clean up relationships referencing this entry
  await deleteRelationshipsByEntry(env.DB, input.id);

  // Remove from Vectorize
  try {
    await env.VECTORIZE.deleteByIds([input.id]);
  } catch (err) {
    throw new Error(
      `Entry ${input.id} deleted from D1 but vector removal failed: ${String(err)}`
    );
  }

  return {
    success: true,
    message: `Entry ${input.id} and its relationships deleted`,
  };
}
```

- [ ] **Step 6: Update `updateEntry` in queries.ts to handle supersedes field**

In `src/db/queries.ts`, update the `updateEntry` function's `fields` parameter type and add handling:

```typescript
export async function updateEntry(
  db: D1Database,
  id: string,
  user_id: string,
  fields: {
    title?: string | null;
    tags?: string | null;
    content?: string;
    namespace?: string | null;
    pinned?: number;
    confirmed_at?: number | null;
    supersedes?: string | null;
  }
): Promise<EntryRow | null> {
  const sets: string[] = ['updated_at = ?'];
  const binds: unknown[] = [Date.now()];

  if ('title'        in fields) { sets.push('title = ?');        binds.push(fields.title ?? null); }
  if ('tags'         in fields) { sets.push('tags = ?');         binds.push(fields.tags ?? null); }
  if (fields.content !== undefined)  { sets.push('content = ?'); binds.push(fields.content); }
  if ('namespace'    in fields) { sets.push('namespace = ?');    binds.push(fields.namespace ?? null); }
  if (fields.pinned  !== undefined)  { sets.push('pinned = ?');  binds.push(fields.pinned); }
  if ('confirmed_at' in fields) { sets.push('confirmed_at = ?'); binds.push(fields.confirmed_at ?? null); }
  if ('supersedes'   in fields) { sets.push('supersedes = ?');   binds.push(fields.supersedes ?? null); }

  binds.push(id, user_id);
  return db
    .prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`)
    .bind(...binds)
    .first<EntryRow>();
}
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/tools/search.ts src/tools/update.ts src/tools/delete.ts src/db/queries.ts test/tools/search.test.ts test/tools/update.test.ts
git commit -m "feat(v3): update search, update, delete tools for V3 domain types"
```

---

### Task 5: Bootstrap Session Tool

**Files:**
- Create: `src/tools/bootstrap.ts`
- Create: `test/tools/bootstrap.test.ts`
- Modify: `src/mcp-server.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/tools/bootstrap.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { bootstrapSession } from '../../src/tools/bootstrap';

vi.mock('../../src/crypto', () => ({
  deriveUserKey: vi.fn().mockResolvedValue({} as CryptoKey),
  safeDecrypt: vi.fn().mockImplementation((content: string) => Promise.resolve(content)),
}));

const makeRow = (overrides: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  user_id: 'u1',
  type: 'memory',
  status: 'active',
  title: null,
  content: 'test content',
  tags: null,
  namespace: 'work',
  pinned: 1,
  resource_name: null,
  resource_location: null,
  confirmed_at: null,
  supersedes: null,
  created_at: Date.now(),
  updated_at: Date.now(),
  ...overrides,
});

const makeMockDb = (rows: any[]) => ({
  prepare: vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: rows }),
    }),
  }),
});

describe('bootstrapSession', () => {
  it('requires namespace parameter', async () => {
    const env = { DB: makeMockDb([]), SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!' } as any;
    // namespace is required in the schema — Zod validates this
    await expect(
      bootstrapSession(env, 'u1', 'google', { namespace: 'work' })
    ).resolves.toBeDefined();
  });

  it('returns entries grouped by domain in prescribed order', async () => {
    const rows = [
      makeRow({ type: 'identity', title: 'Who I am' }),
      makeRow({ type: 'rules', title: 'My rules' }),
      makeRow({ type: 'project', title: 'Active project', pinned: 1 }),
      makeRow({ type: 'handoff', title: 'Follow up', status: 'needs_action', pinned: 0 }),
      makeRow({ type: 'decision', title: 'Recent decision', pinned: 0 }),
    ];
    const env = { DB: makeMockDb(rows), SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!' } as any;
    const result = await bootstrapSession(env, 'u1', 'google', { namespace: 'work' });

    expect(result.sections).toHaveLength(5);
    expect(result.sections[0].domain).toBe('identity');
    expect(result.sections[1].domain).toBe('rules');
    expect(result.sections[2].domain).toBe('project');
    expect(result.sections[3].domain).toBe('handoff');
    expect(result.sections[4].domain).toBe('decision');
  });

  it('omits empty sections', async () => {
    const rows = [
      makeRow({ type: 'identity', title: 'Who I am' }),
    ];
    const env = { DB: makeMockDb(rows), SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!' } as any;
    const result = await bootstrapSession(env, 'u1', 'google', { namespace: 'work' });

    const domains = result.sections.map((s: any) => s.domain);
    expect(domains).toContain('identity');
    expect(domains).not.toContain('rules');
    expect(domains).not.toContain('project');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tools/bootstrap.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement bootstrap tool**

Create `src/tools/bootstrap.ts`:

```typescript
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

// Domain display order for bootstrap response
const BOOTSTRAP_DOMAINS = ['identity', 'rules', 'project', 'handoff', 'decision'] as const;

export async function bootstrapSession(
  env: Env,
  user_id: string,
  provider: string,
  input: z.infer<typeof bootstrapSessionSchema>
): Promise<BootstrapResult> {
  const namespace = input.namespace;

  // Single query: get all entries that should appear in bootstrap
  // - Pinned entries (identity, rules, active projects)
  // - Active handoffs (status = 'needs_action')
  // - Recent decisions (last 30 days OR pinned)
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

  // Decrypt all content
  const key = await deriveUserKey(`${provider}:${user_id}`, env.SERVER_ENCRYPTION_SECRET);
  const entries = await Promise.all(
    result.results.map(async (r) => ({
      ...r,
      content: await safeDecrypt(r.content, key),
    }))
  );

  // Group by domain in prescribed order, omit empty sections
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/tools/bootstrap.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Register bootstrap_session tool in MCP server**

In `src/mcp-server.ts`, add the import and tool registration:

Add import at top:
```typescript
import { bootstrapSession, bootstrapSessionSchema } from './tools/bootstrap';
```

Add tool registration inside `init()`, after the existing `get_resource` registration:

```typescript
    this.server.tool(
      'bootstrap_session',
      'Load session context: identity, rules, active projects, pending handoffs, and recent decisions. Call this at session start with your namespace.',
      bootstrapSessionSchema.shape,
      async (input: any) => {
        const result = await bootstrapSession(this.env, userId, provider, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
    );
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/tools/bootstrap.ts test/tools/bootstrap.test.ts src/mcp-server.ts
git commit -m "feat(v3): bootstrap_session tool — progressive context loading at session start"
```

---

### Task 6: Explore Context Tool (Graph Traversal)

**Files:**
- Create: `src/tools/explore.ts`
- Create: `test/tools/explore.test.ts`
- Modify: `src/mcp-server.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/tools/explore.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { exploreContext } from '../../src/tools/explore';

vi.mock('../../src/crypto', () => ({
  deriveUserKey: vi.fn().mockResolvedValue({} as CryptoKey),
  safeDecrypt: vi.fn().mockImplementation((content: string) => Promise.resolve(content)),
}));

const makeEntry = (id: string, type: string, namespace: string) => ({
  id, user_id: 'u1', type, status: 'active', title: `Entry ${id}`,
  content: 'content', tags: null, namespace, pinned: 0,
  resource_name: null, resource_location: null, confirmed_at: null,
  supersedes: null, created_at: Date.now(), updated_at: Date.now(),
});

const makeRel = (source_id: string, target_id: string, rel_type: string) => ({
  id: crypto.randomUUID(), source_id, target_id, rel_type,
  label: null, valid_from: Date.now(), valid_to: null, created_at: Date.now(),
});

describe('exploreContext', () => {
  it('returns the root entry and its direct relationships', async () => {
    const entry1 = makeEntry('e1', 'project', 'work');
    const entry2 = makeEntry('e2', 'framework', 'work');
    const rel = makeRel('e1', 'e2', 'uses_framework');

    const env = {
      DB: {
        prepare: vi.fn().mockImplementation((sql: string) => ({
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(
              sql.includes('FROM entries') ? entry1 : null
            ),
            all: vi.fn().mockResolvedValue({
              results: sql.includes('FROM relationships') ? [rel] :
                       sql.includes('FROM entries') ? [entry1, entry2] : [],
            }),
          }),
        })),
      },
      SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!',
    } as any;

    const result = await exploreContext(env, 'u1', 'google', {
      entry_id: 'e1',
    });

    expect(result.root.id).toBe('e1');
    expect(result.related).toHaveLength(1);
    expect(result.related[0].entry.id).toBe('e2');
    expect(result.related[0].relationship.rel_type).toBe('uses_framework');
  });

  it('filters out entries from other namespaces without cross_namespace', async () => {
    const entry1 = makeEntry('e1', 'project', 'work');
    const entryPersonal = makeEntry('e3', 'memory', 'personal');
    const rel = makeRel('e1', 'e3', 'related_to');

    const env = {
      DB: {
        prepare: vi.fn().mockImplementation((sql: string) => ({
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(entry1),
            all: vi.fn().mockResolvedValue({
              results: sql.includes('FROM relationships') ? [rel] :
                       sql.includes('FROM entries') ? [entry1, entryPersonal] : [],
            }),
          }),
        })),
      },
      SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!',
    } as any;

    const result = await exploreContext(env, 'u1', 'google', {
      entry_id: 'e1',
      namespace: 'work',
    });

    // Personal entry should be filtered out
    const relatedIds = result.related.map((r: any) => r.entry.id);
    expect(relatedIds).not.toContain('e3');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tools/explore.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement explore context tool**

Create `src/tools/explore.ts`:

```typescript
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
  // Fetch root entry
  const root = await getEntryById(env.DB, input.entry_id, user_id);
  if (!root) {
    throw new Error(`Entry ${input.entry_id} not found`);
  }

  const key = await deriveUserKey(`${provider}:${user_id}`, env.SERVER_ENCRYPTION_SECRET);

  // Determine allowed namespaces for filtering
  const allowedNamespaces = new Set<string | null>(['shared']);
  if (input.namespace) allowedNamespaces.add(input.namespace);
  if (input.cross_namespace) allowedNamespaces.add(input.cross_namespace);
  // If no namespace specified, allow all
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/tools/explore.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Register explore_context tool in MCP server**

In `src/mcp-server.ts`, add the import:

```typescript
import { exploreContext, exploreContextSchema } from './tools/explore';
```

Add tool registration inside `init()`:

```typescript
    this.server.tool(
      'explore_context',
      'Walk the relationship graph from an entry to find all connected context. Use this to pull everything related to a client, project, or decision.',
      exploreContextSchema.shape,
      async (input: any) => {
        const result = await exploreContext(this.env, userId, provider, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
    );
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/tools/explore.ts test/tools/explore.test.ts src/mcp-server.ts
git commit -m "feat(v3): explore_context tool — relationship graph traversal with namespace boundaries"
```

---

### Task 7: Relationship Management MCP Tools

**Files:**
- Create: `src/tools/relationship.ts`
- Create: `test/tools/relationship.test.ts`
- Modify: `src/mcp-server.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/tools/relationship.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { addRelationshipTool, expireRelationshipTool } from '../../src/tools/relationship';

vi.mock('../../src/db/relationships', () => ({
  insertRelationship: vi.fn().mockResolvedValue({
    id: 'rel-1', source_id: 's1', target_id: 't1', rel_type: 'related_to',
    label: null, valid_from: Date.now(), valid_to: null, created_at: Date.now(),
  }),
  expireRelationship: vi.fn().mockResolvedValue(true),
}));

const mockEnv = { DB: {} } as any;

describe('addRelationshipTool', () => {
  it('creates a relationship and returns it', async () => {
    const result = await addRelationshipTool(mockEnv, {
      source_id: 's1',
      target_id: 't1',
      rel_type: 'uses_framework',
      label: 'Uses Three Patterns',
    });
    expect(result.id).toBe('rel-1');
  });
});

describe('expireRelationshipTool', () => {
  it('expires a relationship by id', async () => {
    const result = await expireRelationshipTool(mockEnv, { id: 'rel-1' });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tools/relationship.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement relationship tools**

Create `src/tools/relationship.ts`:

```typescript
import { z } from 'zod';
import { insertRelationship, expireRelationship } from '../db/relationships';
import type { RelationshipRow } from '../db/schema';

export const addRelationshipSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  rel_type: z.string(),
  label: z.string().optional(),
});

export const expireRelationshipSchema = z.object({
  id: z.string().uuid(),
});

export async function addRelationshipTool(
  env: Env,
  input: z.infer<typeof addRelationshipSchema>
): Promise<RelationshipRow> {
  return insertRelationship(env.DB, {
    source_id: input.source_id,
    target_id: input.target_id,
    rel_type: input.rel_type,
    label: input.label,
  });
}

export async function expireRelationshipTool(
  env: Env,
  input: z.infer<typeof expireRelationshipSchema>
): Promise<{ success: boolean; message: string }> {
  const expired = await expireRelationship(env.DB, input.id);
  return {
    success: expired,
    message: expired
      ? `Relationship ${input.id} expired`
      : `No relationship found with id ${input.id}`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/tools/relationship.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Register tools in MCP server**

In `src/mcp-server.ts`, add the import:

```typescript
import { addRelationshipTool, addRelationshipSchema, expireRelationshipTool, expireRelationshipSchema } from './tools/relationship';
```

Add two tool registrations inside `init()`:

```typescript
    this.server.tool(
      'add_relationship',
      'Create a typed relationship between two entries (e.g. project uses_framework, proposal priced_from catalog)',
      addRelationshipSchema.shape,
      async (input: any) => {
        const result = await addRelationshipTool(this.env, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
    );

    this.server.tool(
      'expire_relationship',
      'Mark a relationship as no longer current (sets valid_to to now). The relationship remains for historical queries.',
      expireRelationshipSchema.shape,
      async (input: any) => {
        const result = await expireRelationshipTool(this.env, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
    );
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/tools/relationship.ts test/tools/relationship.test.ts src/mcp-server.ts
git commit -m "feat(v3): add_relationship and expire_relationship MCP tools"
```

---

### Task 8: REST API — Relationships and Bulk Import Endpoints

**Files:**
- Create: `src/api/relationships.ts`
- Create: `src/api/bulk.ts`
- Modify: `src/api/entries.ts`
- Modify: `src/index.ts`
- Create: `test/api/relationships.test.ts`
- Create: `test/api/bulk.test.ts`

- [ ] **Step 1: Write failing tests for relationships API**

Create `test/api/relationships.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleRelationshipsRequest } from '../../src/api/relationships';

vi.mock('../../src/api/auth', () => ({
  extractAdminUserId: vi.fn().mockResolvedValue('user-1'),
}));

vi.mock('../../src/db/relationships', () => ({
  getRelationshipsByEntry: vi.fn().mockResolvedValue([]),
  insertRelationship: vi.fn().mockResolvedValue({
    id: 'rel-1', source_id: 's1', target_id: 't1', rel_type: 'related_to',
    label: null, valid_from: Date.now(), valid_to: null, created_at: Date.now(),
  }),
  expireRelationship: vi.fn().mockResolvedValue(true),
}));

describe('relationships API', () => {
  it('GET /api/entries/:id/relationships returns relationships for an entry', async () => {
    const req = new Request('https://test/api/entries/e1/relationships', {
      headers: { Authorization: 'Bearer token' },
    });
    const res = await handleRelationshipsRequest(req, {} as any, 'e1');
    expect(res.status).toBe(200);
  });

  it('POST /api/relationships creates a relationship', async () => {
    const req = new Request('https://test/api/relationships', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: 's1', target_id: 't1', rel_type: 'related_to' }),
    });
    const res = await handleRelationshipsRequest(req, {} as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe('rel-1');
  });
});
```

- [ ] **Step 2: Write failing tests for bulk import API**

Create `test/api/bulk.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleBulkImport } from '../../src/api/bulk';

vi.mock('../../src/api/auth', () => ({
  extractAdminUserId: vi.fn().mockResolvedValue('user-1'),
}));

vi.mock('../../src/tools/store', () => ({
  storeEntry: vi.fn().mockResolvedValue({ id: 'new-id', message: 'stored' }),
}));

describe('bulk import API', () => {
  it('accepts an array of entries and returns summary', async () => {
    const req = new Request('https://test/api/entries/bulk', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: [
          { type: 'identity', content: 'I am JD', namespace: 'work' },
          { type: 'rules', content: 'Always search first', namespace: 'work' },
        ],
      }),
    });
    const res = await handleBulkImport(req, {} as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(2);
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);
  });

  it('returns 400 for non-array body', async () => {
    const req = new Request('https://test/api/entries/bulk', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'identity', content: 'test' }),
    });
    const res = await handleBulkImport(req, {} as any);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/api/relationships.test.ts test/api/bulk.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement relationships API**

Create `src/api/relationships.ts`:

```typescript
import { extractAdminUserId } from './auth';
import {
  getRelationshipsByEntry,
  insertRelationship,
  expireRelationship,
} from '../db/relationships';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleRelationshipsRequest(
  request: Request,
  env: Env,
  entryId?: string
): Promise<Response> {
  const userId = await extractAdminUserId(request, env.SERVER_ENCRYPTION_SECRET);
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  // GET /api/entries/:id/relationships
  if (request.method === 'GET' && entryId) {
    const url = new URL(request.url);
    const includeExpired = url.searchParams.get('include_expired') === 'true';
    const relType = url.searchParams.get('rel_type') ?? undefined;
    const rels = await getRelationshipsByEntry(env.DB, entryId, { includeExpired, relType });
    return json({ results: rels });
  }

  // POST /api/relationships
  if (request.method === 'POST' && !entryId) {
    let body: Record<string, unknown>;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400); }

    const { source_id, target_id, rel_type, label } = body as any;
    if (!source_id || !target_id || !rel_type) {
      return json({ error: 'source_id, target_id, and rel_type are required' }, 400);
    }

    const rel = await insertRelationship(env.DB, { source_id, target_id, rel_type, label });
    return json(rel);
  }

  // PATCH /api/relationships/:id (expire)
  if (request.method === 'PATCH' && entryId) {
    const expired = await expireRelationship(env.DB, entryId);
    if (!expired) return json({ error: 'Not found' }, 404);
    return json({ success: true, message: `Relationship ${entryId} expired` });
  }

  return json({ error: 'Method not allowed' }, 405);
}
```

- [ ] **Step 5: Implement bulk import API**

Create `src/api/bulk.ts`:

```typescript
import { extractAdminUserId } from './auth';
import { storeEntry } from '../tools/store';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleBulkImport(
  request: Request,
  env: Env
): Promise<Response> {
  const userId = await extractAdminUserId(request, env.SERVER_ENCRYPTION_SECRET);
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  let body: any;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const entries = body.entries;
  if (!Array.isArray(entries)) {
    return json({ error: 'Body must contain an "entries" array' }, 400);
  }

  const results: { index: number; id?: string; error?: string }[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    try {
      const result = await storeEntry(env, userId, 'google', entries[i]);
      results.push({ index: i, id: result.id });
      succeeded++;
    } catch (err) {
      results.push({ index: i, error: String(err) });
      failed++;
    }
  }

  return json({ total: entries.length, succeeded, failed, results });
}
```

- [ ] **Step 6: Wire new routes into the router**

In `src/index.ts`, add imports and route the new endpoints. The exact routing depends on the existing pattern — add handling for:

- `GET /api/entries/:id/relationships` → `handleRelationshipsRequest(request, env, entryId)`
- `POST /api/relationships` → `handleRelationshipsRequest(request, env)`
- `PATCH /api/relationships/:id` → `handleRelationshipsRequest(request, env, relId)`
- `POST /api/entries/bulk` → `handleBulkImport(request, env)`

In `src/api/entries.ts`, add routing for the `/relationships` sub-path. Before the existing method switch (around line 31), add:

```typescript
  // Route /api/entries/:id/relationships to relationship handler
  if (parts[3] === 'relationships') {
    const { handleRelationshipsRequest } = await import('./relationships');
    return handleRelationshipsRequest(request, env, id);
  }

  // Route /api/entries/bulk to bulk import handler
  if (parts[2] === 'bulk' && request.method === 'POST') {
    const { handleBulkImport } = await import('./bulk');
    return handleBulkImport(request, env);
  }
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/api/relationships.ts src/api/bulk.ts src/api/entries.ts test/api/relationships.test.ts test/api/bulk.test.ts
git commit -m "feat(v3): REST API — relationships endpoints and bulk import"
```

---

### Task 9: Admin UI — Domain Filters and Relationship Panel

**Files:**
- Modify: `src/admin/html.ts`

- [ ] **Step 1: Update the type filter dropdown**

In `src/admin/html.ts`, find the existing type filter dropdown (the `<select>` that filters by type) and expand it to include all 9 domain types:

```html
<select id="type-filter">
  <option value="">All Types</option>
  <option value="identity">Identity</option>
  <option value="rules">Rules</option>
  <option value="catalog">Catalog</option>
  <option value="framework">Framework</option>
  <option value="decision">Decision</option>
  <option value="project">Project</option>
  <option value="handoff">Handoff</option>
  <option value="resource">Resource</option>
  <option value="memory">Memory</option>
</select>
```

- [ ] **Step 2: Add namespace filter dropdown**

Add a namespace filter dropdown next to the type filter:

```html
<select id="namespace-filter">
  <option value="">All Namespaces</option>
  <option value="work">Work</option>
  <option value="personal">Personal</option>
  <option value="shared">Shared</option>
  <option value="null">Unnamespaced</option>
</select>
```

Wire it into the existing fetch logic to add `&namespace=` to the API call.

- [ ] **Step 3: Add visual indicators for pinned and superseded entries**

In the entry card rendering, add a pin icon for pinned entries and a "superseded" badge for decisions with a `supersedes` value:

```javascript
const pinnedBadge = entry.pinned ? '<span class="badge pin">📌 Pinned</span>' : '';
const supersededBadge = entry.supersedes ? '<span class="badge superseded">Superseded</span>' : '';
```

- [ ] **Step 4: Add relationships panel to entry cards**

Add an expandable "Relationships" link on each entry card. When clicked, it fetches `GET /api/entries/${id}/relationships` and displays the edges:

```javascript
async function loadRelationships(entryId) {
  const res = await fetch(`/api/entries/${entryId}/relationships`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.results;
}
```

Display each relationship as: `[rel_type] → Entry Title (valid_from — valid_to or "current")`

- [ ] **Step 5: Add bulk select and bulk delete**

Add a checkbox on each entry card. When one or more are selected, show a "Delete Selected" button that calls `DELETE /api/entries/:id` for each selected entry.

```javascript
document.getElementById('bulk-delete').addEventListener('click', async () => {
  const selected = document.querySelectorAll('.entry-checkbox:checked');
  for (const checkbox of selected) {
    await fetch(`/api/entries/${checkbox.dataset.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  loadEntries(); // Refresh
});
```

- [ ] **Step 6: Test in browser**

Run: `npx wrangler dev`
Navigate to the admin UI. Verify:
- Type dropdown shows all 9 domains
- Namespace filter works
- Pinned entries show pin icon
- Relationship panel loads and displays edges
- Bulk select and delete works

- [ ] **Step 7: Commit**

```bash
git add src/admin/html.ts
git commit -m "feat(v3): admin UI — domain filters, namespace filter, relationships panel, bulk delete"
```

---

### Task 10: Update Handoffs Tool for V3 Domain-Aware Filtering

**Files:**
- Modify: `src/tools/handoffs.ts`
- Modify: `test/tools/handoffs.test.ts`

- [ ] **Step 1: Verify existing handoff tests still pass with V3 types**

The handoff tool queries by `type = 'handoff'` which is unchanged. Run existing tests:

Run: `npx vitest run test/tools/handoffs.test.ts`
Expected: All tests PASS (no changes needed to handoffs logic)

- [ ] **Step 2: Update handoff schema if it references old type enum**

Check `src/tools/handoffs.ts` — if the `getHandoffsSchema` includes a type enum, update it. If not (handoffs are always type='handoff'), no change needed.

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add src/tools/handoffs.ts test/tools/handoffs.test.ts
git commit -m "chore(v3): verify handoffs tool compatibility with V3 domain types"
```

---

### Task 11: Deploy Migration and Verify

**Files:**
- No new files — deployment task

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Deploy migration to production D1**

Run: `npx wrangler d1 migrations apply limitless-mcp --remote`
Expected: Migration 0003 applied

- [ ] **Step 4: Deploy worker**

Run: `npx wrangler deploy`
Expected: Deployed successfully

- [ ] **Step 5: Smoke test via MCP client**

Connect to the deployed worker via an MCP client and verify:
1. `bootstrap_session(namespace: "work")` returns structured sections
2. `store_entry` accepts V3 domain types (e.g., `type: "identity"`)
3. `store_entry` with `relationships` array creates edges
4. `explore_context` walks the graph
5. `add_relationship` and `expire_relationship` work
6. `search_memory` accepts V3 type filter (e.g., `type: "catalog"`)
7. Admin UI shows new filters and relationship panel

- [ ] **Step 6: Commit any smoke-test fixes**

```bash
git add -A
git commit -m "fix(v3): post-deploy fixes from smoke testing"
```

---

### Task 12: Update README and Tool Descriptions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the tools table in README**

Add the 4 new tools (`bootstrap_session`, `explore_context`, `add_relationship`, `expire_relationship`) to the tools documentation.

- [ ] **Step 2: Update the entry types section**

Document the 9 domain types with descriptions and typical usage.

- [ ] **Step 3: Add relationship graph section**

Document relationship types, temporal validity, and the `explore_context` traversal pattern.

- [ ] **Step 4: Update the system prompt examples**

Replace `get_pinned_context` with `bootstrap_session` in the example system prompt. Add the cross-namespace handoff rule.

- [ ] **Step 5: Add migration/import section**

Document the three import paths (AI Vault, organic vault, cross-AI) and the bulk import endpoint.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: update README for V3 — domains, relationships, bootstrap, import"
```
