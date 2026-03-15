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
At the start of each session, call get_handoffs to retrieve any pending action items.
Search Limitless for context relevant to the current topic using search_memory before
relying solely on native memory. If a Limitless entry tagged `confirmed` conflicts with
native memory, trust Limitless. If no confirmed tag exists and a conflict is detected,
surface both versions with timestamps and ask which is current.
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
| `store_entry` | Save a memory, context note, handoff, or resource entry |
| `search_memory` | Semantic search across your stored entries |
| `get_handoffs` | Retrieve all pending handoff items |
| `archive_handoff` | Mark a handoff as completed |
| `get_pinned_context` | Retrieve all pinned entries (optionally filtered by namespace) |
| `get_resource` | Look up a resource entry by name or tag |
| `update_entry` | Update fields on an existing entry (content, tags, namespace, pinned, confirmed_at) |
| `delete_entry` | Permanently remove an entry |

---

## Entry types

| Type | Use for |
|------|---------|
| `context` | Persistent identity — who you are, projects, specs. Rarely changes. |
| `memory` | Accumulated knowledge — facts, preferences, decisions, insights. |
| `handoff` | Action items — where work left off, what's next. Auto-archives on consumption. |
| `resource` | Named resources — file paths, URIs, prompt templates, tool references. Retrieved by name or tag via `get_resource`. |

All entries optionally belong to a namespace (`work`, `personal`, or `shared`). `shared` entries appear in every namespace session. Pin important entries with `pinned: true` — they're returned by `get_pinned_context` at session start.

## Staleness and confirmed_at

Set `confirmed_at` (unix ms) when you've verified an entry is current. The AI treats confirmed entries as facts and hedges on everything else. For role or location entries, system prompts should instruct the AI to flag entries older than 12–18 months and ask the user to re-confirm. Use `update_entry` with a fresh `confirmed_at` to renew.

---

## Admin interface

Visit `/admin` on your deployed Worker to browse and manage entries without going through an AI. Authenticate with your Google account. You can filter by namespace, type, and pinned status, assign namespaces to existing entries, pin/unpin, and delete.

The admin UI uses a REST API (`GET/PATCH/DELETE /api/entries`) authenticated via a short-lived HMAC session token issued at `/admin/callback`.

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

## License

MIT
