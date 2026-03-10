# Limitless MCP — Build Plan for Claude Code

## Project Overview

Build a Cloudflare-native MCP (Model Context Protocol) server called **Limitless** that provides portable AI memory and context across any device and any MCP-compatible AI tool. This is a personal knowledge infrastructure layer — not a file sync system, but a portable identity and context layer that makes any AI immediately aware of who the user is, how they work, and where they left off.

The product solves AI amnesia: every new chat window starts from zero. Limitless gives any connected AI instant access to persistent context, accumulated memory, and active handoff states — from any device, any AI client, anywhere.

**Tagline:** Portable you. Any AI. Anywhere.

---

## Stack — All Cloudflare

| Product | Purpose |
|---|---|
| Cloudflare Workers | MCP server logic and API endpoints |
| Cloudflare D1 | Structured metadata, entry records, handoff states |
| Cloudflare Vectorize | Vector embeddings for semantic search |
| Workers AI | Generate embeddings (text-embedding model) |
| Workers OAuth Provider Library | Native OAuth 2.1 with Google as identity provider |
| Wrangler CLI | Local development and deployment |

No external vendors. No Supabase. No separate database accounts. Everything lives in one Cloudflare account.

---

## Repository Setup

The GitHub repo `limitless-mcp` already exists online and is blank. Claude Code should:

1. Clone the repo locally
2. Scaffold a new Cloudflare Workers project inside it using Wrangler
3. Set up the project structure as defined below
4. Commit the initial scaffold before writing any logic

```bash
git clone https://github.com/[username]/limitless-mcp
cd limitless-mcp
npx wrangler init . --no-delegate-c3
```

> **Pause point:** Confirm the Wrangler scaffold completed and initial commit is pushed before proceeding.

---

## Project Structure

```
limitless-mcp/
├── src/
│   ├── index.ts              # Worker entry point — OAuthProvider wraps MCP server
│   ├── auth-handler.ts       # Google OAuth flow handler
│   ├── mcp-server.ts         # McpAgent class with all tool definitions
│   ├── tools/
│   │   ├── store.ts          # Store a new entry (any layer)
│   │   ├── search.ts         # Semantic search via Vectorize
│   │   ├── handoffs.ts       # Retrieve and archive handoff entries
│   │   └── recall.ts         # Retrieve recent entries by type
│   ├── db/
│   │   ├── schema.ts         # D1 table definitions
│   │   └── queries.ts        # Reusable D1 query functions
│   └── embeddings.ts         # Workers AI embedding generation
├── migrations/
│   └── 0001_initial.sql      # D1 schema migration
├── wrangler.toml             # Cloudflare config, bindings
├── package.json
└── README.md
```

---

## Authentication Architecture

Limitless uses the **Cloudflare Workers OAuth Provider Library** (`@cloudflare/workers-oauth-provider`) with **Google as the identity provider**. This is Option 3 from the Cloudflare MCP authorization docs — the Worker handles the complete OAuth flow itself, using Google to authenticate users.

### Why this approach

- Self-contained — no Cloudflare Access dependency, no manual user management
- Multi-tenant by design — Google identity (sub claim) becomes the user namespace in D1
- Self-serve — future users authenticate themselves without the owner doing anything
- Standard OAuth 2.1 — works with any MCP client that supports OAuth

### How the auth flow works

```
MCP Client → Worker (401) → Browser opens Google login →
Google authenticates → Worker receives callback →
Worker issues its own MCP token → MCP Client stores token →
All future MCP requests use that token
```

### Data isolation via Google identity

Every D1 entry includes a `user_id` column populated from `this.props.claims.sub` (the Google user's unique ID). All queries filter by `user_id`. User A cannot see User B's entries — enforced at the query level in every tool.

### Entry point — `src/index.ts`

```typescript
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { LimitlessMCP } from "./mcp-server";
import { GoogleAuthHandler } from "./auth-handler";

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: LimitlessMCP.Router,
  defaultHandler: GoogleAuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
```

### Auth handler — `src/auth-handler.ts`

Implement the Google OAuth flow:
1. Redirect user to Google's authorization endpoint with the app's `GOOGLE_CLIENT_ID`
2. Handle the callback at `/callback`
3. Exchange the authorization code for a Google access token
4. Extract the user's identity (sub, email, name) from the Google token
5. Issue a Limitless MCP token bound to that identity
6. Store minimal user record in D1 on first login

Reference the Cloudflare GitHub OAuth example for the exact pattern, substituting Google's OAuth endpoints:
- Authorization: `https://accounts.google.com/o/oauth2/v2/auth`
- Token: `https://oauth2.googleapis.com/token`
- Scopes needed: `openid email profile`

The GitHub OAuth example is at: https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth

---

## Google OAuth Setup

> **Pause point — user action required before writing auth code:**
>
> The user needs to create Google OAuth credentials before this step can be completed.
>
> Steps:
> 1. Go to https://console.cloud.google.com
> 2. Create a new project called "Limitless MCP"
> 3. Go to APIs & Services → Credentials
> 4. Configure OAuth consent screen (External, add app name and email)
> 5. Create OAuth Client ID → Web Application
> 6. Add authorized redirect URI: `https://limitless-mcp.[username].workers.dev/callback`
> 7. Copy the Client ID and Client Secret
>
> Then set them as Wrangler secrets:
> ```bash
> npx wrangler secret put GOOGLE_CLIENT_ID
> npx wrangler secret put GOOGLE_CLIENT_SECRET
> npx wrangler secret put COOKIE_SECRET
> ```
> (COOKIE_SECRET can be any random 32+ character string — generate one at https://1password.com/password-generator/)

---

## Data Model

Three distinct entry types stored in D1, each with a corresponding vector embedding in Vectorize.

### D1 Table: `entries`

```sql
CREATE TABLE entries (
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

CREATE INDEX idx_entries_user_type ON entries(user_id, type);
CREATE INDEX idx_entries_user_status ON entries(user_id, status);
```

### D1 Table: `users`

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
```

### Entry Types

**`context`** — Persistent identity layer
- Who the user is, how they work, frameworks and methodologies
- Source: migrated from CLAUDE.md, context.md, framework.md
- Status: always `active`
- Rarely updated, never deleted
- Examples: working style preferences, Three Patterns framework, client engagement approach

**`memory`** — Accumulated knowledge layer
- Meeting transcripts from Granola, decisions made, insights captured, client context
- Status: `active`
- Grows continuously over time
- Examples: "Ethanol client wants consulting beyond standard workshops", "Session 2 scheduled for CS team"

**`handoff`** — Transient action layer
- Where work left off, what's been decided, what needs to happen next
- Created during strategic conversations on any device
- Status: `needs_action` → `actioned` (archived after consumed)
- Examples: "Finished planning Limitless architecture on phone. Tomorrow in Code: scaffold repo, set up D1 bindings, write store tool first."

### Vectorize Index

One index: `limitless-index`
- Dimensions: 768 (matching Workers AI `@cf/baai/bge-base-en-v1.5` embedding model)
- Each entry in D1 has a corresponding vector in Vectorize with matching `id`
- Metadata stored on vector: `type`, `status`, `user_id`
- All Vectorize queries must filter by `user_id` in metadata to enforce data isolation

---

## MCP Server — `src/mcp-server.ts`

```typescript
import { McpAgent } from "agents/mcp";

interface AuthContext {
  claims: {
    sub: string;    // Google user ID — used as user_id throughout
    email: string;
    name: string;
  };
}

export class LimitlessMCP extends McpAgent<Env, unknown, AuthContext> {
  async init() {
    // Register all four tools here
    // this.props.claims.sub is available in every tool handler
    // Always pass this.props.claims.sub as user_id to all D1 queries
  }
}
```

---

## MCP Tools to Expose

The MCP server exposes four tools. Every tool filters by `user_id` from `this.props.claims.sub`.

### 1. `store_entry`
Store a new entry into Limitless.

**Input:**
```json
{
  "type": "context | memory | handoff",
  "title": "Short descriptive title",
  "content": "Full text content of the entry",
  "tags": "optional, comma separated"
}
```

**Behavior:**
1. Get `user_id` from `this.props.claims.sub`
2. Generate embedding via Workers AI (`@cf/baai/bge-base-en-v1.5`)
3. Insert record into D1 with generated UUID, `user_id`, and timestamps
4. Upsert vector into Vectorize with entry ID and metadata including `user_id`
5. Return confirmation with entry ID

---

### 2. `search_memory`
Semantic search across the authenticated user's active entries.

**Input:**
```json
{
  "query": "Natural language search query",
  "type": "optional filter: context | memory | handoff",
  "limit": "number of results, default 5"
}
```

**Behavior:**
1. Get `user_id` from `this.props.claims.sub`
2. Generate embedding for the query via Workers AI
3. Query Vectorize for top matches filtered by `user_id` and optionally `type` in metadata
4. Retrieve full content from D1 using returned IDs, confirming `user_id` match
5. Return ranked results with type, title, content, and created date

---

### 3. `get_handoffs`
Retrieve all active handoffs for the authenticated user.

**Input:** none required

**Behavior:**
1. Get `user_id` from `this.props.claims.sub`
2. Query D1 for entries where `user_id = ?` AND `type = 'handoff'` AND `status = 'needs_action'`
3. Return ordered by `created_at` descending
4. Designed to be called at the start of a new work session

---

### 4. `archive_handoff`
Mark a handoff as actioned.

**Input:**
```json
{
  "id": "entry ID to archive"
}
```

**Behavior:**
1. Get `user_id` from `this.props.claims.sub`
2. Update D1 entry status to `actioned` WHERE `id = ?` AND `user_id = ?` (user_id check prevents cross-user archiving)
3. Update vector metadata in Vectorize
4. Return confirmation

---

## wrangler.toml Configuration

```toml
name = "limitless-mcp"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "limitless-db"
database_id = "REPLACE_AFTER_CREATION"

[[vectorize]]
binding = "VECTORIZE"
index_name = "limitless-index"

[ai]
binding = "AI"
```

> **Pause point:** After wrangler.toml is scaffolded, run the following and paste output back to confirm IDs:
> ```bash
> npx wrangler d1 create limitless-db
> npx wrangler vectorize create limitless-index --dimensions=768 --metric=cosine
> ```

---

## npm Packages Required

```bash
npm install @cloudflare/workers-oauth-provider
npm install agents
npm install @modelcontextprotocol/sdk
```

---

## D1 Migration

File: `migrations/0001_initial.sql` — use the full schema defined above including both tables and both indexes.

Apply migrations:
```bash
npx wrangler d1 migrations apply limitless-db --local
npx wrangler d1 migrations apply limitless-db --remote
```

> **Pause point:** Confirm migration applied successfully before writing tool logic.

---

## Build Sequence

Claude Code should build in this exact order. Complete and confirm each step before moving to the next.

1. **Scaffold** — Clone repo, init Wrangler project, install npm packages, commit structure
2. **Infrastructure** — Create D1 database, create Vectorize index, update wrangler.toml with IDs
3. **Schema** — Write and apply D1 migration (both tables, both indexes)
4. **Embeddings** — Write `embeddings.ts` helper using Workers AI binding
5. **Store tool** — Write and test `store.ts` (validates D1 + Vectorize + AI all working together)
6. **Search tool** — Write and test `search.ts` (validates semantic search end to end)
7. **Handoff tools** — Write `handoffs.ts` for get and archive
8. **MCP server** — Wire all tools into `mcp-server.ts` McpAgent class
9. **Auth handler** — Write `auth-handler.ts` Google OAuth flow

   > **Pause point — user action required:** Set up Google OAuth credentials in Google Cloud Console and run:
   > ```bash
   > npx wrangler secret put GOOGLE_CLIENT_ID
   > npx wrangler secret put GOOGLE_CLIENT_SECRET
   > npx wrangler secret put COOKIE_SECRET
   > ```

10. **Entry point** — Wire OAuthProvider in `index.ts` wrapping the MCP server
11. **Deploy** — `npx wrangler deploy`
12. **Update Google redirect URI** — After deploy, confirm the deployed Worker URL matches the redirect URI set in Google Cloud Console. Update in Google if needed, then redeploy.
13. **MCP config** — Output the exact JSON config block for Claude Desktop and Claude Mobile

---

## Final Output from Claude Code

After successful deployment, output:

1. The deployed Worker URL (`https://limitless-mcp.[username].workers.dev`)
2. MCP configuration JSON block ready to paste into Claude Desktop `claude_desktop_config.json`
3. Instructions for adding to Claude Mobile
4. Auth test — open the Worker URL in a browser and confirm Google login screen appears
5. MCP tool test — after authenticating, call `get_handoffs` and confirm empty array returns cleanly

---

## Notes for Claude Code

- TypeScript throughout
- Use `McpAgent` from the `agents` package for the MCP server class
- Use `OAuthProvider` from `@cloudflare/workers-oauth-provider` as the entry point wrapper
- Reference the GitHub OAuth example at https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth for the auth handler pattern — substitute Google endpoints for GitHub endpoints
- Every single D1 query must include `user_id` in the WHERE clause — no exceptions
- Every Vectorize query must include `user_id` metadata filter — no exceptions
- D1 queries must use prepared statements (`db.prepare(...).bind(...)`)
- UUIDs via `crypto.randomUUID()`
- Timestamps as Unix epoch integers via `Date.now()`
- All errors return meaningful messages, not raw exceptions
- Auth reference docs: https://developers.cloudflare.com/agents/model-context-protocol/authorization/
