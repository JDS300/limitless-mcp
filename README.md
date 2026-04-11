# Limitless

A portable, self-hosted memory layer for AI tools — store context, memories, and handoffs once and access them from Claude, ChatGPT, or any MCP-compatible client.

For more information, visit [limitless-ai.dev](https://limitless-ai.dev).

## How it works

Limitless runs as a Cloudflare Worker with D1 (SQLite) for structured storage and Vectorize for semantic search. You authenticate with Google OAuth, then store entries that any connected AI client can retrieve via MCP. Each user's data is encrypted at rest with a per-user AES-GCM key derived from your `SERVER_ENCRYPTION_SECRET`.

Cloudflare Workers uses an isolated, per-request execution model — each invocation spins up a fresh context with no persistent memory. Plaintext is never accumulated between requests. Combined with AES-GCM encryption at rest, the hosting provider cannot read stored payloads. See [how Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/).

For a visual overview, see the [architecture diagram](https://limitless-ai.dev/architecture).

---

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works for personal use)
- Node.js + npm
- Wrangler CLI: `npm install -g wrangler`
- Google Cloud project with OAuth 2.0 credentials
  - Authorized redirect URI: `https://<your-worker>.workers.dev/callback`

---

## Deploy your own instance

### 1. Clone and install

```bash
git clone https://github.com/JDS300/limitless-mcp
cd limitless-mcp
npm install
```

### 2. Create Cloudflare resources

```bash
npx wrangler login
npx wrangler d1 create limitless-db
npx wrangler vectorize create limitless-index --dimensions=768 --metric=cosine
npx wrangler vectorize create-metadata-index limitless-index --propertyName user_id --type string
npx wrangler vectorize create-metadata-index limitless-index --propertyName type --type string
npx wrangler vectorize create-metadata-index limitless-index --propertyName status --type string
```

### 3. Update wrangler.toml

After running `wrangler d1 create`, copy the `database_id` from the output and update it in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "limitless-db"
database_id = "<paste your database_id here>"
```

Also create a KV namespace and update the `id`:

```bash
npx wrangler kv namespace create OAUTH_KV
```

```toml
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "<paste your kv namespace id here>"
```

### 4. Google OAuth setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add `https://<your-worker>.workers.dev/callback` as an authorized redirect URI
4. Copy the Client ID and Client Secret — you'll use them in the next step

### 5. Set secrets

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY
npx wrangler secret put SERVER_ENCRYPTION_SECRET
```

| Secret | Purpose |
|--------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth app client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth app client secret |
| `COOKIE_ENCRYPTION_KEY` | Encrypts OAuth session cookies — generate with `openssl rand -base64 32` |
| `SERVER_ENCRYPTION_SECRET` | Per-user AES-GCM key derivation — generate with `openssl rand -base64 32` (must differ from `COOKIE_ENCRYPTION_KEY`) |

### 6. Run the database migrations

```bash
npx wrangler d1 execute limitless-db --remote --file=migrations/0001_initial.sql
npx wrangler d1 execute limitless-db --remote --file=migrations/0002_v2_schema.sql
npx wrangler d1 execute limitless-db --remote --file=migrations/0003_v3_schema.sql
```

### 7. Deploy

```bash
npm run deploy
```

Your worker will be live at `https://limitless-mcp.<your-subdomain>.workers.dev`.

---

## Connecting MCP clients

Limitless supports two integration paths:

- **MCP clients** (Claude Desktop, Claude Code, any MCP-native tool): plug-and-play via the MCP config below.
- **Non-MCP tools** (ChatGPT, Gemini, any web UI): use the system prompt / custom instructions snippet. This is a fully supported path.

### Claude / Claude Code

Add to your `claude_desktop_config.json` (or Claude Code settings):

```json
{
  "mcpServers": {
    "limitless": {
      "url": "https://limitless-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

Add to your system prompt or project instructions:

```
Call bootstrap_session with the appropriate namespace before any task.
Use limitless-mcp for all context — do not assert facts without searching.
Cross-namespace writes go through handoffs, never direct mutations.
If a Limitless entry conflicts with native memory, prefer the source
with the newer timestamp and surface the discrepancy.
```

### ChatGPT

Add to your custom instructions:

```
I use a personal memory tool called Limitless at https://limitless-mcp.<your-subdomain>.workers.dev.
At the start of each session, retrieve my handoffs and search for relevant context before answering.
```

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `bootstrap_session` | Load session context — identity, rules, active projects, handoffs, recent decisions. Call at session start with your namespace. |
| `store_entry` | Save an entry (identity, rules, catalog, framework, decision, project, handoff, resource, or memory). Optionally create relationships in the same call. |
| `search_memory` | Semantic search across stored entries. Filter by domain type and namespace. |
| `explore_context` | Walk the relationship graph from any entry to find all connected context. |
| `add_relationship` | Create a typed, temporal relationship between two entries. |
| `expire_relationship` | Mark a relationship as no longer current (historical queries still find it). |
| `get_handoffs` | Retrieve all pending handoff items. |
| `archive_handoff` | Mark a handoff as completed. |
| `get_pinned_context` | Retrieve pinned entries (deprecated — use `bootstrap_session`). |
| `get_resource` | Look up a resource entry by name or tag. |
| `update_entry` | Update entry fields including content, tags, namespace, pinned, confirmed_at, and supersedes. |
| `delete_entry` | Permanently remove an entry and its relationships. |

---

## Entry domains

Entries are organized into 9 domain types. Each domain serves a specific role in the knowledge architecture.

| Domain | Purpose | Typically pinned? |
|--------|---------|-------------------|
| `identity` | Who you are — name, role, org, style preferences, banned language | Always |
| `rules` | Behavioral directives — guardrails, consistency checks, pushback rules | Always |
| `catalog` | Service offerings with pricing, descriptions, inclusions | No — searched on demand |
| `framework` | Methodologies, models, repeatable approaches | No — searched on demand |
| `decision` | Decisions with date, rationale, and optional `supersedes` link | Recent/important only |
| `project` | Project status, goals, client, phase, key deliverables | Active projects |
| `handoff` | Cross-session tasks and follow-ups | needs_action items at bootstrap |
| `resource` | Templates, prompts, URIs, reusable artifacts | No — deterministic lookup |
| `memory` | Catch-all for anything that doesn't fit the above | Varies |

All entries belong to a namespace (`work`, `personal`, or `shared`). `shared` entries appear in every namespace. Pin entries with `pinned: true` to include them in `bootstrap_session` results.

### Decision chains

Decision entries support a `supersedes` field — a reference to the ID of the decision being overridden. This creates an explicit audit chain and prevents relitigating past decisions.

### Staleness and confirmed_at

Set `confirmed_at` (unix ms) when you've verified an entry is current. System prompts should instruct the AI to flag entries older than 12–18 months and ask the user to re-confirm.

## Relationship graph

Entries can be connected by typed, directional, temporal relationships.

| Relationship | Meaning | Example |
|-------------|---------|---------|
| `uses_framework` | Work product uses a methodology | Proposal → Three Patterns |
| `priced_from` | Pricing sourced from catalog | SOW → AI Workshop $5,000 |
| `decided_by` | Shaped by a decision | Project scope → Decision |
| `supersedes` | Newer decision replaces older | Decision B → Decision A |
| `delivered_to` | Work product for a project | Proposal → Client XYZ |
| `related_to` | General association | Any → Any |

Relationships have temporal validity — `valid_from` and `valid_to` timestamps. When a fact changes, the old relationship expires and a new one is created. Use `explore_context` to walk the graph from any entry.

## Bootstrap protocol

Call `bootstrap_session(namespace)` at the start of every session. It returns:

1. **Identity** — who you are, style preferences
2. **Rules** — behavioral directives and guardrails
3. **Active projects** — pinned project summaries
4. **Pending handoffs** — unactioned cross-session tasks
5. **Recent decisions** — last 30 days, pinned or high-importance

Total: ~800-1500 tokens. Everything else is retrieved on demand via `search_memory` or `explore_context`.

## Namespace isolation

- **Writes**: namespace is required. Cross-namespace writes create a handoff in the target namespace.
- **Reads**: default to session namespace + shared. Cross-namespace reads require explicit `cross_namespace` parameter and are read-only (no trace left in target namespace).

---

## Admin interface

Visit `/admin` on your deployed Worker to browse and manage entries without going through an AI. Authenticate with your Google account. You can filter by namespace, type, and pinned status, assign namespaces to existing entries, pin/unpin, and delete.

The admin UI uses a REST API (`GET/PATCH/DELETE /api/entries`) authenticated via a short-lived HMAC session token issued at `/admin/callback`.

The admin UI supports filtering by all 9 domain types and namespace, viewing relationships for any entry, and bulk selection with bulk delete for post-import cleanup.

## OAuth providers

Limitless is built on Cloudflare's OAuth provider library, which supports Google, GitHub, Microsoft, LinkedIn, and others. The encryption key scheme (`{provider}:{user_id}`) is designed so adding a new provider requires no key rotation for existing users. Currently only Google is wired up; adding a second provider is a small auth-handler change.

## Conflict resolution

When a Limitless entry and an AI's native memory disagree:

1. AI finds a Limitless entry on the current topic
2. AI checks native memory for anything related
3. If conflict → both versions surfaced with timestamps, user picks
4. User confirms → call `update_entry` with `tags: "confirmed"` on the correct entry
5. Future sessions: confirmed Limitless entries are trusted without asking

---

## Import and migration

Limitless supports importing from existing knowledge stores:

- **AI Vault (structured)**: Import from CLAUDE.md / CONTEXT.md / SERVICE_CATALOG.md pattern. Content maps directly to domain types.
- **Obsidian / organic vault**: AI reads, classifies, and proposes domain mappings for user review.
- **Cross-AI memory**: Export from ChatGPT, Gemini, or other AI services. Prompt-driven, maps to Limitless domains.

Use `POST /api/entries/bulk` for batch import. Import prompts are stored as resource entries in Limitless for retrieval.

---

## License

MIT
