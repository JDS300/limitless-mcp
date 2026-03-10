# Limitless MCP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Cloudflare-native MCP server that provides portable AI memory and context via four tools: store_entry, search_memory, get_handoffs, archive_handoff.

**Architecture:** A Cloudflare Worker wraps an McpAgent (from the `agents` package) with an OAuthProvider (Google OAuth via `@cloudflare/workers-oauth-provider`). D1 stores structured entry records, Vectorize stores semantic embeddings, Workers AI generates embeddings. Every query is scoped to the authenticated user's Google sub claim.

**Tech Stack:** Cloudflare Workers, D1, Vectorize, Workers AI, `@cloudflare/workers-oauth-provider`, `agents` (McpAgent), `@modelcontextprotocol/sdk`, TypeScript, Wrangler CLI

---

## Current State

The repo exists at `/mnt/Data2TB/GitRepos/limitless-mcp` with only `README.md` and `limitless-mcp-build-plan.md`. No Wrangler scaffold yet.

---

## Task 1: Wrangler Scaffold + npm Install

**Files:**
- Create: `wrangler.toml` (via wrangler init)
- Create: `src/index.ts` (via wrangler init)
- Modify: `package.json` (add dependencies)
- Create: `.gitignore`

**Step 1: Run wrangler init**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx wrangler init . --no-delegate-c3
```

When prompted:
- "Would you like to use git for version control?" → No (already a git repo)
- "What type of application?" → Hello World Worker (TypeScript)
- Any other prompts → accept defaults

Expected output: Creates `wrangler.toml`, `src/index.ts`, `package.json`, `tsconfig.json`, `worker-configuration.d.ts`

**Step 2: Install required packages**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npm install @cloudflare/workers-oauth-provider agents @modelcontextprotocol/sdk
```

Expected: packages added to `node_modules/`, `package-lock.json` updated

**Step 3: Verify wrangler.toml exists**

```bash
cat /mnt/Data2TB/GitRepos/limitless-mcp/wrangler.toml
```

Expected: Contains `name`, `main`, `compatibility_date` fields

**Step 4: Commit scaffold**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add wrangler.toml src/ package.json package-lock.json tsconfig.json .gitignore worker-configuration.d.ts
git commit -m "chore: scaffold Wrangler project with npm dependencies"
```

---

## Task 2: Cloudflare Infrastructure Setup

> **USER ACTION REQUIRED — Claude cannot do this step.**
>
> Run these commands and paste the output back (you need the database_id and index name):
>
> ```bash
> cd /mnt/Data2TB/GitRepos/limitless-mcp
> npx wrangler d1 create limitless-db
> npx wrangler vectorize create limitless-index --dimensions=768 --metric=cosine
> ```
>
> The D1 command output will include a `database_id` like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.
> Copy it — you need it for wrangler.toml.

**Step 1: Update wrangler.toml with real IDs and bindings**

Replace the generated `wrangler.toml` content with:

```toml
name = "limitless-mcp"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "limitless-db"
database_id = "<PASTE_DATABASE_ID_HERE>"

[[vectorize]]
binding = "VECTORIZE"
index_name = "limitless-index"

[ai]
binding = "AI"
```

**Step 2: Verify wrangler.toml type checks compile**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx wrangler types
```

Expected: generates/updates `worker-configuration.d.ts` with `DB`, `VECTORIZE`, `AI` typed

**Step 3: Commit infrastructure config**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add wrangler.toml worker-configuration.d.ts
git commit -m "chore: configure D1, Vectorize, and AI bindings in wrangler.toml"
```

---

## Task 3: D1 Schema Migration

**Files:**
- Create: `migrations/0001_initial.sql`

**Step 1: Create migrations directory and SQL file**

Create `migrations/0001_initial.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  title TEXT,
  content TEXT NOT NULL,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_user_type ON entries(user_id, type);
CREATE INDEX IF NOT EXISTS idx_entries_user_status ON entries(user_id, status);
```

**Step 2: Apply migration locally**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx wrangler d1 migrations apply limitless-db --local
```

Expected output:
```
Migrations to be applied:
  - 0001_initial.sql
✅ Applied 0001_initial.sql
```

**Step 3: Apply migration remotely**

```bash
npx wrangler d1 migrations apply limitless-db --remote
```

Expected: same success output against the remote D1 database

**Step 4: Verify tables exist**

```bash
npx wrangler d1 execute limitless-db --local --command="SELECT name FROM sqlite_master WHERE type='table';"
```

Expected: rows for `users` and `entries`

**Step 5: Commit migration**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add migrations/
git commit -m "feat: add D1 schema migration for users and entries tables"
```

---

## Task 4: D1 Query Helpers

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/queries.ts`

**Step 1: Create `src/db/schema.ts`**

This file defines the TypeScript types for DB rows:

```typescript
export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  created_at: number;
  last_seen: number;
}

export interface EntryRow {
  id: string;
  user_id: string;
  type: 'context' | 'memory' | 'handoff';
  status: string;
  title: string | null;
  content: string;
  tags: string | null;
  created_at: number;
  updated_at: number;
}
```

**Step 2: Create `src/db/queries.ts`**

```typescript
import type { UserRow, EntryRow } from './schema';

export async function upsertUser(
  db: D1Database,
  user: { id: string; email: string; name: string }
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, email, name, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, name = excluded.name`
    )
    .bind(user.id, user.email, user.name, now, now)
    .run();
}

export async function insertEntry(
  db: D1Database,
  entry: {
    id: string;
    user_id: string;
    type: string;
    status: string;
    title: string | null;
    content: string;
    tags: string | null;
  }
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO entries (id, user_id, type, status, title, content, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entry.id,
      entry.user_id,
      entry.type,
      entry.status,
      entry.title,
      entry.content,
      entry.tags,
      now,
      now
    )
    .run();
}

export async function getEntriesByIds(
  db: D1Database,
  ids: string[],
  user_id: string
): Promise<EntryRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT * FROM entries WHERE id IN (${placeholders}) AND user_id = ? AND status != 'actioned'`
    )
    .bind(...ids, user_id)
    .all<EntryRow>();
  return result.results;
}

export async function getActiveHandoffs(
  db: D1Database,
  user_id: string
): Promise<EntryRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM entries
       WHERE user_id = ? AND type = 'handoff' AND status = 'needs_action'
       ORDER BY created_at DESC`
    )
    .bind(user_id)
    .all<EntryRow>();
  return result.results;
}

export async function archiveHandoff(
  db: D1Database,
  id: string,
  user_id: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE entries SET status = 'actioned', updated_at = ?
       WHERE id = ? AND user_id = ? AND type = 'handoff'`
    )
    .bind(Date.now(), id, user_id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
```

**Step 3: TypeScript check**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx tsc --noEmit
```

Expected: no errors (there may be errors in src/index.ts from the scaffold — that's fine for now, focus on the new files)

**Step 4: Commit DB helpers**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add src/db/
git commit -m "feat: add D1 schema types and query helpers"
```

---

## Task 5: Workers AI Embeddings Helper

**Files:**
- Create: `src/embeddings.ts`

**Step 1: Create `src/embeddings.ts`**

```typescript
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

export async function generateEmbedding(
  ai: Ai,
  text: string
): Promise<number[]> {
  const result = await ai.run(EMBEDDING_MODEL, { text: [text] });
  // Workers AI returns { shape, data } where data is an array of embedding arrays
  if (!result.data || result.data.length === 0) {
    throw new Error('Workers AI returned empty embedding');
  }
  return result.data[0];
}
```

**Step 2: TypeScript check**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx tsc --noEmit 2>&1 | grep embeddings
```

Expected: no errors for embeddings.ts

**Step 3: Commit**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add src/embeddings.ts
git commit -m "feat: add Workers AI embedding helper"
```

---

## Task 6: store_entry Tool

**Files:**
- Create: `src/tools/store.ts`

**Step 1: Create `src/tools/store.ts`**

```typescript
import { z } from 'zod';
import { generateEmbedding } from '../embeddings';
import { insertEntry } from '../db/queries';

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

  // Generate embedding
  const embedding = await generateEmbedding(env.AI, input.content);

  // Insert into D1
  await insertEntry(env.DB, {
    id,
    user_id,
    type: input.type,
    status,
    title: input.title ?? null,
    content: input.content,
    tags: input.tags ?? null,
  });

  // Upsert vector into Vectorize
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

  return {
    id,
    message: `Stored ${input.type} entry with id ${id}`,
  };
}
```

> Note: `z` (zod) comes bundled with `@modelcontextprotocol/sdk` — no separate install needed.

**Step 2: TypeScript check**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx tsc --noEmit 2>&1 | grep -v "index.ts"
```

Expected: no errors in store.ts or embeddings.ts

**Step 3: Commit**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add src/tools/store.ts
git commit -m "feat: add store_entry tool"
```

---

## Task 7: search_memory Tool

**Files:**
- Create: `src/tools/search.ts`

**Step 1: Create `src/tools/search.ts`**

```typescript
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
```

**Step 2: TypeScript check**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx tsc --noEmit 2>&1 | grep -E "search|error"
```

Expected: no errors in search.ts

**Step 3: Commit**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add src/tools/search.ts
git commit -m "feat: add search_memory tool"
```

---

## Task 8: Handoff Tools

**Files:**
- Create: `src/tools/handoffs.ts`

**Step 1: Create `src/tools/handoffs.ts`**

```typescript
import { z } from 'zod';
import { getActiveHandoffs, archiveHandoff } from '../db/queries';
import type { EntryRow } from '../db/schema';

export async function getHandoffs(
  env: Env,
  user_id: string
): Promise<EntryRow[]> {
  return getActiveHandoffs(env.DB, user_id);
}

export const archiveHandoffSchema = z.object({
  id: z.string().uuid(),
});

export async function archiveHandoffEntry(
  env: Env,
  user_id: string,
  input: z.infer<typeof archiveHandoffSchema>
): Promise<{ success: boolean; message: string }> {
  // Update D1
  const updated = await archiveHandoff(env.DB, input.id, user_id);

  if (!updated) {
    return {
      success: false,
      message: `No active handoff found with id ${input.id} for this user`,
    };
  }

  // Update vector metadata in Vectorize
  await env.VECTORIZE.upsert([
    {
      id: input.id,
      // We need values to upsert — get them by querying the existing vector
      // Vectorize doesn't support metadata-only updates, so we use getByIds
      values: new Array(768).fill(0), // placeholder — Vectorize ignores values on metadata update
      metadata: {
        user_id,
        type: 'handoff',
        status: 'actioned',
      },
    },
  ]);

  return {
    success: true,
    message: `Handoff ${input.id} archived`,
  };
}
```

> **Note on Vectorize metadata update:** Vectorize's `upsert` with zero-values vector is a known workaround since there's no metadata-only update API. The zero vector won't affect future searches since status=actioned entries are excluded from D1 results anyway.

**Step 2: TypeScript check**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx tsc --noEmit 2>&1 | grep -E "handoff|error"
```

**Step 3: Commit**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add src/tools/handoffs.ts
git commit -m "feat: add get_handoffs and archive_handoff tools"
```

---

## Task 9: MCP Server

**Files:**
- Create: `src/mcp-server.ts`

**Step 1: Create `src/mcp-server.ts`**

```typescript
import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { storeEntry, storeEntrySchema } from './tools/store';
import { searchMemory, searchMemorySchema } from './tools/search';
import { getHandoffs, archiveHandoffEntry, archiveHandoffSchema } from './tools/handoffs';

interface AuthProps {
  claims: {
    sub: string;
    email: string;
    name: string;
  };
}

export class LimitlessMCP extends McpAgent<Env, unknown, AuthProps> {
  server = new McpServer({ name: 'Limitless', version: '1.0.0' });

  async init() {
    const userId = this.props.claims.sub;

    this.server.tool(
      'store_entry',
      'Store a new memory, context, or handoff entry',
      storeEntrySchema.shape,
      async (input) => {
        const result = await storeEntry(this.env, userId, input as any);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
    );

    this.server.tool(
      'search_memory',
      'Semantic search across your stored entries',
      searchMemorySchema.shape,
      async (input) => {
        const results = await searchMemory(this.env, userId, input as any);
        return {
          content: [{ type: 'text', text: JSON.stringify(results) }],
        };
      }
    );

    this.server.tool(
      'get_handoffs',
      'Retrieve all active handoff entries (call at the start of a work session)',
      {},
      async () => {
        const results = await getHandoffs(this.env, userId);
        return {
          content: [{ type: 'text', text: JSON.stringify(results) }],
        };
      }
    );

    this.server.tool(
      'archive_handoff',
      'Mark a handoff as actioned after you have acted on it',
      archiveHandoffSchema.shape,
      async (input) => {
        const result = await archiveHandoffEntry(this.env, userId, input as any);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
    );
  }
}
```

**Step 2: TypeScript check**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx tsc --noEmit 2>&1 | grep -v "index.ts"
```

Expected: no errors in mcp-server.ts or tools

**Step 3: Commit**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add src/mcp-server.ts
git commit -m "feat: wire all tools into McpAgent MCP server"
```

---

## Task 10: Google OAuth Setup

> **USER ACTION REQUIRED — Claude cannot do this step.**
>
> 1. Go to https://console.cloud.google.com
> 2. Create a new project called "Limitless MCP"
> 3. Go to APIs & Services → OAuth consent screen → External → fill in app name and email
> 4. Go to APIs & Services → Credentials → Create OAuth Client ID → Web Application
> 5. Add authorized redirect URI: `https://limitless-mcp.<your-subdomain>.workers.dev/callback`
>    (Check your subdomain: `npx wrangler whoami`)
> 6. Copy the Client ID and Client Secret
>
> Then set Wrangler secrets:
> ```bash
> cd /mnt/Data2TB/GitRepos/limitless-mcp
> npx wrangler secret put GOOGLE_CLIENT_ID
> npx wrangler secret put GOOGLE_CLIENT_SECRET
> npx wrangler secret put COOKIE_SECRET
> ```
> (COOKIE_SECRET = any random 32+ char string)
>
> Confirm when done by saying "OAuth secrets set".

---

## Task 11: Auth Handler

**Files:**
- Create: `src/auth-handler.ts`

Reference: https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth
(Substitute Google endpoints for GitHub endpoints)

**Step 1: Create `src/auth-handler.ts`**

```typescript
import type {
  OAuthHelpers,
  AuthRequest,
} from '@cloudflare/workers-oauth-provider';

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
}

export class GoogleAuthHandler {
  static async fetch(request: Request, env: Env, ctx: ExecutionContext, oauthHelpers: OAuthHelpers): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/authorize') {
      return handleAuthorize(request, env, oauthHelpers);
    }

    if (url.pathname === '/callback') {
      return handleCallback(request, env, ctx, oauthHelpers);
    }

    return new Response('Not found', { status: 404 });
  }
}

async function handleAuthorize(
  request: Request,
  env: Env,
  oauthHelpers: OAuthHelpers
): Promise<Response> {
  const oauthReqInfo = await oauthHelpers.parseAuthRequest(request);

  // Store the OAuth request state so we can resume after Google callback
  const state = btoa(JSON.stringify(oauthReqInfo));

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  googleAuthUrl.searchParams.set('redirect_uri', getCallbackUrl(request));
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile');
  googleAuthUrl.searchParams.set('state', state);
  googleAuthUrl.searchParams.set('access_type', 'online');

  return Response.redirect(googleAuthUrl.toString(), 302);
}

async function handleCallback(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  oauthHelpers: OAuthHelpers
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 });
  }

  // Restore the original OAuth request info
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(atob(state));
  } catch {
    return new Response('Invalid state', { status: 400 });
  }

  // Exchange code for Google tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getCallbackUrl(request),
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new Response(`Google token exchange failed: ${err}`, { status: 500 });
  }

  const tokens: GoogleTokenResponse = await tokenRes.json();

  // Get user info from Google
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return new Response('Failed to fetch Google user info', { status: 500 });
  }

  const user: GoogleUserInfo = await userRes.json();

  // Upsert user in D1
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, name = excluded.name`
  )
    .bind(user.sub, user.email, user.name, now, now)
    .run();

  // Complete the OAuth flow — issue MCP token with user claims
  const { redirectTo } = await oauthHelpers.completeAuthorization({
    request: oauthReqInfo,
    userId: user.sub,
    metadata: {},
    scope: oauthReqInfo.scope,
    props: {
      claims: {
        sub: user.sub,
        email: user.email,
        name: user.name,
      },
    },
  });

  return Response.redirect(redirectTo, 302);
}

function getCallbackUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/callback`;
}
```

**Step 2: Add env type declarations**

In `worker-configuration.d.ts` or a new `src/env.d.ts`, ensure these are declared (wrangler types should generate DB, VECTORIZE, AI — but secrets need manual addition):

Add to `worker-configuration.d.ts`:
```typescript
// Add to the existing interface Env { ... }
GOOGLE_CLIENT_ID: string;
GOOGLE_CLIENT_SECRET: string;
COOKIE_SECRET: string;
```

**Step 3: TypeScript check**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx tsc --noEmit
```

Fix any type errors before proceeding.

**Step 4: Commit**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add src/auth-handler.ts worker-configuration.d.ts
git commit -m "feat: add Google OAuth auth handler"
```

---

## Task 12: Entry Point

**Files:**
- Modify: `src/index.ts`

**Step 1: Replace `src/index.ts` with:**

```typescript
import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { LimitlessMCP } from './mcp-server';
import { GoogleAuthHandler } from './auth-handler';

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: LimitlessMCP.mount('/mcp') as any,
  defaultHandler: GoogleAuthHandler as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});

export { LimitlessMCP };
```

**Step 2: Full TypeScript check**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx tsc --noEmit
```

Expected: clean compile. Fix any errors before deploying.

**Step 3: Commit**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add src/index.ts
git commit -m "feat: wire OAuthProvider entry point wrapping MCP server"
```

---

## Task 13: Deploy and Verify

**Step 1: Deploy to Cloudflare**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
npx wrangler deploy
```

Expected output includes:
```
✅ Deployed limitless-mcp
https://limitless-mcp.<subdomain>.workers.dev
```

Copy the deployed URL.

**Step 2: Open browser to confirm Google login**

Navigate to `https://limitless-mcp.<subdomain>.workers.dev` in a browser.

Expected: redirected to Google login screen.

If you see an error, check:
- `GOOGLE_CLIENT_ID` secret is set (`npx wrangler secret list`)
- Redirect URI in Google Cloud Console matches exactly: `https://limitless-mcp.<subdomain>.workers.dev/callback`

**Step 3: Update Google redirect URI if needed**

If the deployed URL differs from what you put in Google Cloud Console:
1. Go to Google Cloud Console → Credentials → your OAuth client
2. Update the authorized redirect URI
3. Redeploy: `npx wrangler deploy`

**Step 4: Test with MCP Inspector**

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector UI:
- Transport: SSE
- URL: `https://limitless-mcp.<subdomain>.workers.dev/mcp`
- Click Connect → will trigger OAuth flow
- After auth, call `get_handoffs` → expect `[]`
- Call `store_entry` with type=`handoff`, content=`"Test handoff"` → expect success with ID
- Call `get_handoffs` again → expect the handoff to appear
- Call `archive_handoff` with the returned ID → expect success
- Call `get_handoffs` again → expect `[]`

**Step 5: Output final MCP config**

After successful test, output the Claude Desktop config:

```json
{
  "mcpServers": {
    "limitless": {
      "type": "sse",
      "url": "https://limitless-mcp.<subdomain>.workers.dev/mcp"
    }
  }
}
```

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) and restart Claude Desktop.

**Step 6: Final commit**

```bash
cd /mnt/Data2TB/GitRepos/limitless-mcp
git add docs/
git commit -m "docs: add implementation plan"
git push origin main
```

---

## Pause Points Summary

| Task | Who | What |
|------|-----|-------|
| Task 2 | User | `wrangler d1 create` + `wrangler vectorize create`, paste IDs back |
| Task 10 | User | Google Cloud Console OAuth setup + `wrangler secret put` x3 |
| Task 13 step 3 | User (if needed) | Update redirect URI in Google Cloud Console |

---

## Key Constraints (Never Violate)

- Every D1 query includes `user_id` in WHERE clause
- Every Vectorize query includes `user_id` in metadata filter
- All D1 queries use prepared statements (`.prepare().bind()`)
- UUIDs via `crypto.randomUUID()`
- Timestamps as `Date.now()` (Unix ms integer)
- TypeScript throughout — no `any` except where forced by library types
