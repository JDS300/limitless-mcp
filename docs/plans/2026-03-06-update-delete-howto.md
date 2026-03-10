# update_entry + delete_entry + HOWTO Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `update_entry` (PATCH) and `delete_entry` (DELETE) MCP tools to Limitless, plus a HOWTO.md for users.

**Architecture:** Each tool follows the existing pattern: a query function in `src/db/queries.ts`, a tool module in `src/tools/`, and registration in `src/mcp-server.ts`. Both tools must keep D1 and Vectorize in sync. `update_entry` re-embeds only when `content` changes. `delete_entry` removes from both D1 and Vectorize.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), Vectorize, Workers AI (bge-base-en-v1.5 embeddings), Zod, MCP SDK

---

## Codebase Orientation

Key files:
- `src/db/queries.ts` — all D1 query functions
- `src/db/schema.ts` — `EntryRow` and `UserRow` TypeScript interfaces
- `src/tools/store.ts` — reference implementation for a tool (D1 insert + Vectorize upsert)
- `src/tools/handoffs.ts` — reference for Vectorize metadata update pattern
- `src/mcp-server.ts` — registers all MCP tools; import and call tool functions here
- `src/embeddings.ts` — `generateEmbedding(ai, text): Promise<number[]>`

The `Env` type (from `wrangler types`) exposes `env.DB` (D1Database), `env.VECTORIZE` (VectorizeIndex), `env.AI` (Ai).

Vectorize relevant methods:
- `env.VECTORIZE.upsert([{ id, values, metadata }])` — insert or update
- `env.VECTORIZE.deleteByIds([id])` — delete vector by ID

No test runner is configured. Verification is: `npx tsc --noEmit` (type check) + live MCP tool calls.

---

### Task 1: D1 query functions for update and delete

**Files:**
- Modify: `src/db/queries.ts`

**Step 1: Add `updateEntry` query function**

Append to `src/db/queries.ts`:

```typescript
export async function updateEntry(
  db: D1Database,
  id: string,
  user_id: string,
  fields: { tags?: string | null; content?: string }
): Promise<EntryRow | null> {
  const sets: string[] = ['updated_at = ?'];
  const binds: unknown[] = [Date.now()];

  if ('tags' in fields) {
    sets.push('tags = ?');
    binds.push(fields.tags ?? null);
  }
  if (fields.content !== undefined) {
    sets.push('content = ?');
    binds.push(fields.content);
  }

  binds.push(id, user_id);

  const result = await db
    .prepare(
      `UPDATE entries SET ${sets.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`
    )
    .bind(...binds)
    .first<EntryRow>();

  return result ?? null;
}
```

**Step 2: Add `deleteEntry` query function**

Append to `src/db/queries.ts`:

```typescript
export async function deleteEntry(
  db: D1Database,
  id: string,
  user_id: string
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM entries WHERE id = ? AND user_id = ?`)
    .bind(id, user_id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
```

**Step 3: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat: add updateEntry and deleteEntry D1 query functions"
```

---

### Task 2: `delete_entry` tool

**Files:**
- Create: `src/tools/delete.ts`

**Step 1: Create the file**

```typescript
import { z } from 'zod';
import { deleteEntry } from '../db/queries';

export const deleteEntrySchema = z.object({
  id: z.string().uuid(),
});

export async function deleteEntryTool(
  env: Env,
  user_id: string,
  input: z.infer<typeof deleteEntrySchema>
): Promise<{ success: boolean; message: string }> {
  // Delete from D1
  const deleted = await deleteEntry(env.DB, input.id, user_id);

  if (!deleted) {
    return {
      success: false,
      message: `No entry found with id ${input.id} for this user`,
    };
  }

  // Remove vector from Vectorize
  await env.VECTORIZE.deleteByIds([input.id]);

  return {
    success: true,
    message: `Entry ${input.id} deleted`,
  };
}
```

**Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/tools/delete.ts
git commit -m "feat: add deleteEntryTool"
```

---

### Task 3: `update_entry` tool

**Files:**
- Create: `src/tools/update.ts`

**Step 1: Create the file**

```typescript
import { z } from 'zod';
import { updateEntry } from '../db/queries';
import { generateEmbedding } from '../embeddings';
import type { EntryRow } from '../db/schema';

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

  // Update D1
  const entry = await updateEntry(env.DB, input.id, user_id, fields);

  if (!entry) {
    return {
      success: false,
      entry: null,
      message: `No entry found with id ${input.id} for this user`,
    };
  }

  // Re-embed in Vectorize only if content changed
  if (input.content !== undefined) {
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
  }

  return {
    success: true,
    entry,
    message: `Entry ${input.id} updated`,
  };
}
```

**Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/tools/update.ts
git commit -m "feat: add updateEntryTool with selective re-embedding"
```

---

### Task 4: Register both tools in mcp-server.ts

**Files:**
- Modify: `src/mcp-server.ts`

**Step 1: Add imports**

At the top of `src/mcp-server.ts`, add after the existing imports:

```typescript
import { deleteEntryTool, deleteEntrySchema } from './tools/delete';
import { updateEntryTool, updateEntrySchema } from './tools/update';
```

**Step 2: Register `delete_entry` tool**

Inside `init()`, after the `archive_handoff` tool registration, add:

```typescript
    this.server.tool(
      'delete_entry',
      'Permanently delete an entry by ID',
      deleteEntrySchema.shape,
      async (input: any) => {
        const result = await deleteEntryTool(this.env, userId, input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }
    );
```

**Step 3: Register `update_entry` tool**

After `delete_entry`, add:

```typescript
    this.server.tool(
      'update_entry',
      'Update tags or content of an existing entry',
      updateEntrySchema.shape,
      async (input: any) => {
        const result = await updateEntryTool(this.env, userId, input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }
    );
```

**Step 4: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/mcp-server.ts
git commit -m "feat: register delete_entry and update_entry MCP tools"
```

---

### Task 5: Deploy and verify

**Step 1: Deploy**

```bash
npm run deploy
```

Expected: `Deployed limitless-mcp triggers` with a new version ID.

**Step 2: Verify delete_entry**

Call `store_entry` to create a test entry:
- type: `memory`
- content: `delete test entry`

Note the returned `id`. Then call `delete_entry` with that `id`.

Expected response: `{ "success": true, "message": "Entry <id> deleted" }`

**Step 3: Verify the deleted entry is gone**

Call `search_memory` with query `delete test entry`.

Expected: the deleted entry does NOT appear in results.

**Step 4: Verify update_entry — tags only**

Call `store_entry` with type `memory`, content `update test entry`.

Note the `id`. Call `update_entry` with `{ id, tags: "confirmed" }`.

Expected: `{ "success": true, "entry": { ..., "tags": "confirmed" }, "message": "Entry <id> updated" }`

**Step 5: Verify update_entry — content change**

Call `update_entry` with `{ id, content: "updated content for re-embedding test" }`.

Expected: `{ "success": true, "entry": { ..., "content": "updated content for re-embedding test" } }`

Then call `search_memory` with query `updated content re-embedding`.

Expected: the updated entry appears in results.

**Step 6: Commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: <describe fix>"
```

---

### Task 6: Write HOWTO.md

**Files:**
- Create: `docs/HOWTO.md`

**Step 1: Create the file**

```markdown
# Limitless — How to Use

Limitless is a portable memory layer for AI tools. It runs on Cloudflare (Workers + D1 + Vectorize) and gives you semantic search across everything you've intentionally stored — across Claude, ChatGPT, Gemini, or any AI that supports MCP or system prompts.

This is a supplement to native AI memory, not a replacement. Native memory is automatic and model-specific. Limitless is intentional, portable, and cross-model.

---

## Setup

### Prerequisites

- Cloudflare account (free tier works)
- Google OAuth app (for authentication)
- Node.js and `npm` or `npx`
- Wrangler CLI: `npm install -g wrangler`

### Deploy

```bash
git clone https://github.com/JDS300/limitless-mcp
cd limitless-mcp
npx wrangler login
npx wrangler d1 create limitless-db
npx wrangler vectorize create limitless-index --dimensions=768 --metric=cosine
npx wrangler vectorize create-metadata-index limitless-index --propertyName user_id --type string
npx wrangler vectorize create-metadata-index limitless-index --propertyName type --type string
npx wrangler vectorize create-metadata-index limitless-index --propertyName status --type string
```

Update `wrangler.toml` with your D1 database ID and Vectorize index name.

Set secrets:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY  # any 32+ char random string
```

Run the D1 migration to create the schema:

```bash
npx wrangler d1 execute limitless-db --remote --file=migrations/0001_initial.sql
```

Deploy:

```bash
npm run deploy
```

Your worker will be live at `https://limitless-mcp.<your-subdomain>.workers.dev`.

---

## Connecting to Claude

Add to your Claude system prompt or project instructions:

```
At the start of each session, call get_handoffs to retrieve any pending action items.
Search Limitless for context relevant to the current topic using search_memory before relying solely on native memory.
If a Limitless entry tagged `confirmed` conflicts with native memory, trust Limitless.
If no confirmed tag exists and a conflict is detected, surface both versions with timestamps and ask which is current.
```

In Claude's MCP settings, add the server URL: `https://limitless-mcp.<your-subdomain>.workers.dev/mcp`

---

## Connecting to ChatGPT / Gemini

Limitless exposes an MCP endpoint. For AI tools that don't natively support MCP, paste this into your custom instructions:

```
I use a personal memory tool called Limitless at https://limitless-mcp.<your-subdomain>.workers.dev.
At the start of each session, retrieve my handoffs and search for relevant context before answering.
```

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `store_entry` | Save a memory, context note, or handoff |
| `search_memory` | Semantic search across your stored entries |
| `get_handoffs` | Retrieve all pending handoff items |
| `archive_handoff` | Mark a handoff as completed |
| `update_entry` | Update tags or content on an existing entry |
| `delete_entry` | Permanently remove an entry |

### Entry Types

- **memory** — facts, preferences, decisions you want to persist
- **context** — project state, specs, designs
- **handoff** — action items to pick up next session

### Tags

Tags are free-form comma-separated strings. The `confirmed` tag has special meaning: it marks an entry as verified-current for conflict resolution.

---

## Conflict Resolution

When AI native memory and Limitless disagree:

1. AI finds a Limitless entry on the topic
2. AI checks native memory for anything related
3. If conflict detected → both versions surfaced with timestamps, user picks
4. User confirms → call `update_entry` with `tags: "confirmed"` on the correct entry
5. Future sessions → confirmed Limitless entry trusted over native memory without asking

Confirmed entries older than 90 days on time-sensitive topics (roles, projects, tools) should be re-confirmed rather than silently trusted.

---

## Import Workflows

### Migrate existing AI memory to Limitless

Export your memory from your AI tool (if available), then use `store_entry` with type `memory` for each item. Tag with `imported` to distinguish from natively-created entries.

### Import from Obsidian

Use a script to iterate your vault notes and call `store_entry` for each. Set type `context` for project notes, `memory` for facts and preferences.
```

**Step 2: Commit**

```bash
git add docs/HOWTO.md
git commit -m "docs: add HOWTO.md covering setup, tools, and conflict resolution"
```

---

### Task 7: Archive the two handoff entries and clean up test entries

**Step 1: Archive both handoff entries**

Call `archive_handoff` with id `557b104f-3e38-4fa7-827b-e803d18f42f6` (PATCH + HOWTO handoff).

Call `archive_handoff` with id `91d90f58-50a8-447b-b251-2768fa049fb0` (DELETE handoff).

**Step 2: Delete the two test entries left from search validation**

Call `delete_entry` with id `80008545-3e44-49d9-a7d7-42b8aba1af09` (original search validation test).

Call `delete_entry` with id `23bb577f-ae4a-435a-8719-dcbb5e221855` (second search verification test).

**Step 3: Verify handoffs are cleared**

Call `get_handoffs`. Neither archived handoff should appear.

---

### Task 8: Open PR

```bash
git push -u origin <branch>
gh pr create --title "feat: add update_entry and delete_entry MCP tools + HOWTO" --body "..."
```
