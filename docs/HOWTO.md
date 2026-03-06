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
