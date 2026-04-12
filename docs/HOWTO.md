# Limitless MCP — How To Use

## Overview

Limitless is a portable AI context engine. It stores encrypted entries organized into 9 domain types, connected by a temporal relationship graph, with semantic search via Cloudflare Vectorize. All entries are scoped to a single authenticated user and a namespace (`work`, `personal`, or `shared`).

---

## MCP Tool Reference

### `bootstrap_session`

Load session context at the start of a conversation. Returns identity, rules, active projects, pending handoffs, and recent decisions in a single call.

| Parameter   | Type     | Required | Description                          |
|------------|----------|----------|--------------------------------------|
| `namespace` | `string` | yes      | Session namespace: `work`, `personal`, or `shared` |

Returns entries grouped by domain in prescribed order: identity, rules, project, handoff, decision. Empty domains are omitted. Total ~800-1500 tokens.

---

### `store_entry`

Store a new entry. Encrypts content, generates an embedding, and inserts into D1 + Vectorize.

| Parameter           | Type     | Required | Description                                                      |
|--------------------|----------|----------|------------------------------------------------------------------|
| `type`             | `string` | yes      | Domain type: `identity\|rules\|catalog\|framework\|decision\|project\|handoff\|resource\|memory` |
| `content`          | `string` | yes      | The main content to store (encrypted at rest)                    |
| `title`            | `string` | no       | Short label for the entry                                        |
| `tags`             | `string` | no       | Comma-separated tags for filtering                               |
| `namespace`        | `string` | no       | Scope: `work`, `personal`, or `shared`                           |
| `pinned`           | `boolean`| no       | Mark as pinned (included in `bootstrap_session` results)         |
| `resource_name`    | `string` | no       | For `type: resource` — resource identifier name                  |
| `resource_location`| `string` | no       | For `type: resource` — URI or path                               |
| `supersedes`       | `string` | no       | UUID of a decision entry this one overrides                      |
| `relationships`    | `array`  | no       | Array of `{target_id, rel_type, label}` to create with the entry |

---

### `search_memory`

Semantic search across stored entries using Vectorize.

| Parameter   | Type     | Required | Description                                                      |
|------------|----------|----------|------------------------------------------------------------------|
| `query`    | `string` | yes      | Natural language search query                                    |
| `type`     | `string` | no       | Filter by domain type (`identity`, `catalog`, `decision`, etc.)  |
| `namespace`| `string` | no       | Limit results to a namespace (+ `shared` entries always included)|
| `limit`    | `number` | no       | Max results (default 5, max 20)                                  |

---

### `explore_context`

Walk the relationship graph from a starting entry to find all connected context.

| Parameter        | Type      | Required | Description                                          |
|-----------------|-----------|----------|------------------------------------------------------|
| `entry_id`      | `string`  | yes      | UUID of the entry to start from                      |
| `rel_type`      | `string`  | no       | Filter to a specific relationship type               |
| `depth`         | `number`  | no       | How many hops to follow (1-3, default 1)             |
| `namespace`     | `string`  | no       | Filter traversal to this namespace + shared          |
| `cross_namespace`| `string` | no       | Also include entries from this namespace (read-only) |
| `include_expired`| `boolean`| no       | Include expired relationships (default false)        |

Returns the root entry and all related entries with their relationship edges and direction (outgoing/incoming).

---

### `add_relationship`

Create a typed, temporal relationship between two entries.

| Parameter   | Type     | Required | Description                                    |
|------------|----------|----------|------------------------------------------------|
| `source_id`| `string` | yes      | UUID of the source entry                       |
| `target_id`| `string` | yes      | UUID of the target entry                       |
| `rel_type` | `string` | yes      | Relationship type (e.g. `uses_framework`, `priced_from`, `decided_by`, `supersedes`, `delivered_to`, `related_to`) |
| `label`    | `string` | no       | Human-readable description of the relationship |

Both entries must belong to the authenticated user.

---

### `expire_relationship`

Mark a relationship as no longer current. Sets `valid_to` to now. The relationship remains for historical queries with `include_expired: true`.

| Parameter | Type     | Required | Description                         |
|----------|----------|----------|-------------------------------------|
| `id`     | `string` | yes      | UUID of the relationship to expire  |

---

### `get_handoffs`

Retrieve all active handoff entries (status: `needs_action`). Call at the start of a work session for continuity.

| Parameter   | Type     | Required | Description                              |
|------------|----------|----------|------------------------------------------|
| `namespace`| `string` | no       | Filter handoffs to a specific namespace  |

---

### `archive_handoff`

Mark a handoff as actioned after you have acted on it.

| Parameter | Type     | Required | Description                  |
|----------|----------|----------|------------------------------|
| `id`     | `string` | yes      | ID of the handoff to archive |

---

### `get_pinned_context` *(deprecated — use `bootstrap_session`)*

Retrieve all pinned entries. Kept for backward compatibility.

| Parameter   | Type     | Required | Description                              |
|------------|----------|----------|------------------------------------------|
| `namespace`| `string` | no       | Filter to a namespace (+ shared)         |

---

### `get_resource`

Retrieve stored resources by exact name or tag search.

| Parameter | Type     | Required | Description                          |
|----------|----------|----------|--------------------------------------|
| `name`   | `string` | no       | Exact match on `resource_name`       |
| `tag`    | `string` | no       | Substring match against tags field   |

At least one of `name` or `tag` is required.

---

### `update_entry`

Update fields of an existing entry. Re-encrypts and re-embeds on content change.

| Parameter      | Type      | Required | Description                                       |
|---------------|-----------|----------|---------------------------------------------------|
| `id`          | `string`  | yes      | ID of the entry to update                         |
| `title`       | `string`  | no       | New title                                         |
| `content`     | `string`  | no       | New content (re-encrypted + re-embedded on change)|
| `tags`        | `string`  | no       | New tags                                          |
| `namespace`   | `string`  | no       | Move entry to a different namespace               |
| `pinned`      | `boolean` | no       | Set or unset pinned flag                          |
| `confirmed_at`| `number`  | no       | Unix ms timestamp of confirmation                 |
| `supersedes`  | `string`  | no       | UUID of a decision this one overrides             |

---

### `delete_entry`

Permanently delete an entry by ID. Removes from D1, Vectorize, and cascade-deletes all associated relationships.

| Parameter | Type     | Required | Description                  |
|----------|----------|----------|------------------------------|
| `id`     | `string` | yes      | ID of the entry to delete    |

---

## Entry Domains

Entries are organized into 9 domain types. Each serves a specific role in the knowledge architecture.

| Domain      | Purpose                                                    | Typically pinned? |
|------------|------------------------------------------------------------|--------------------|
| `identity` | Who you are — name, role, org, style preferences           | Always             |
| `rules`    | Behavioral directives — guardrails, pushback rules         | Always             |
| `catalog`  | Service offerings with pricing, descriptions, inclusions   | No — searched on demand |
| `framework`| Methodologies, models, repeatable approaches               | No — searched on demand |
| `decision` | Decisions with date, rationale, and optional supersedes link| Recent/important   |
| `project`  | Project status, goals, client, phase, key deliverables     | Active projects    |
| `handoff`  | Cross-session tasks and follow-ups                         | needs_action at bootstrap |
| `resource` | Templates, prompts, URIs, reusable artifacts               | No — deterministic lookup |
| `memory`   | Catch-all for anything that doesn't fit the above          | Varies             |

---

## Relationship Graph

Entries can be connected by typed, directional, temporal relationships.

| Relationship     | Meaning                                | Example                        |
|-----------------|----------------------------------------|--------------------------------|
| `uses_framework` | Work product uses a methodology       | Proposal → Three Patterns      |
| `priced_from`    | Pricing sourced from catalog entry    | SOW → AI Workshop $5,000       |
| `decided_by`     | Shaped by a specific decision         | Project scope → Decision       |
| `supersedes`     | Newer decision replaces older one     | Decision B → Decision A        |
| `delivered_to`   | Work product associated with a project| Proposal → Client XYZ project  |
| `related_to`     | General association (catch-all edge)  | Any → Any                      |

Relationships have temporal validity — `valid_from` and `valid_to` timestamps. When a fact changes (e.g., pricing update), the old relationship is expired and a new one created. Both remain queryable for historical context.

Use `explore_context` to walk the graph from any entry:

```
explore_context(entry_id: "<client-xyz-project-id>")
→ returns the project entry + all related entries: proposals, frameworks used, pricing sources, decisions
```

---

## Decision Chains

Decision entries support a `supersedes` field — a reference to the ID of the decision being overridden. This creates an explicit audit chain:

```
Decision: "Workshop is $5,000" (2026-04-01)
    ↑ superseded by
Decision: "Workshop is $4,500 for Q2 promo" (2026-04-10)
```

When Claude encounters a superseded decision, it follows the chain to the current one. This prevents relitigating past decisions.

---

## Bootstrap Protocol

Call `bootstrap_session(namespace)` at the start of every session. It returns:

1. **Identity** — who you are, style preferences (~100-200 tokens)
2. **Rules** — behavioral directives and guardrails (~200-400 tokens)
3. **Active projects** — pinned project summaries (~200-500 tokens)
4. **Pending handoffs** — unactioned cross-session tasks (~100-300 tokens)
5. **Recent decisions** — last 30 days, pinned or high-importance (~100-200 tokens)

Total: ~800-1500 tokens. Everything else is retrieved on demand via `search_memory` or `explore_context`.

---

## Namespace Scoping

Namespaces partition your context. Common patterns:

- `work` — work-related context, projects, client information
- `personal` — personal preferences, life context
- `shared` — entries accessible from all namespaces

**Write rules:**
- Writes go to the session namespace. Cross-namespace writes create a handoff in the target namespace.
- `shared` entries can be written from any session.

**Read rules:**
- Reads return the session namespace + `shared` by default.
- Cross-namespace reads require the explicit `cross_namespace` parameter and are read-only — no trace left in the target namespace.

---

## System Prompt Snippets

### Claude / Claude Code (MCP-capable)

```
Call bootstrap_session with the appropriate namespace before any task.
Use limitless-mcp for all context — do not assert facts without searching.
Cross-namespace writes go through handoffs, never direct mutations.
If a Limitless entry conflicts with native memory, prefer the source
with the newer timestamp and surface the discrepancy.
```

### ChatGPT / Gemini (non-MCP)

```
You have a Limitless memory tool. At the start of each conversation,
search for context about the user's topic. Confirmed entries are facts;
surface unconfirmed entries with hedging ("I have you as X — still current?").
```

---

## Confirmed Flag + Staleness

- Set `confirmed_at` (unix ms) when you've verified an entry is current.
- The AI should assert confirmed entries confidently and hedge unconfirmed ones.
- Fact-type entries (role, location, relationships) are flagged for re-confirmation after ~12-18 months.

---

## Admin Interface

Visit `/admin` on your deployed Worker. Sign in with the same Google account you use for MCP.

**What you can do:**
- Filter entries by domain type (all 9 types) and namespace
- Assign or clear namespace on any entry
- Pin/unpin entries
- View relationships for any entry (expandable panel showing edges, types, and validity)
- Bulk select and delete entries (useful for post-import cleanup)
- Delete individual entries

---

## REST API

The REST API uses Bearer token auth — the token is issued at `/admin/callback` and expires after 8 hours.

```
GET    /api/entries                      — list entries (filters: namespace, type, status, pinned, limit, offset)
GET    /api/entries/:id                  — fetch a single entry (content decrypted)
PATCH  /api/entries/:id                  — update fields (namespace, title, tags, pinned, content, confirmed_at, supersedes)
DELETE /api/entries/:id                  — permanently delete from D1, Vectorize, and relationships

POST   /api/entries/bulk                 — batch import entries (array in "entries" field, returns per-item results)
GET    /api/entries/:id/relationships    — list relationships for an entry
POST   /api/relationships               — create a relationship (source_id, target_id, rel_type, label)
PATCH  /api/relationships/:id           — expire a relationship (sets valid_to to now)
```

**Auth header:**
```
Authorization: Bearer <token>
```
