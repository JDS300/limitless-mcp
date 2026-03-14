# Limitless MCP — How To Use

## Overview

Limitless is a portable AI context layer. It stores encrypted entries in Cloudflare D1 and enables semantic search via Vectorize. All entries are scoped to a single authenticated user and optionally to a namespace (e.g. `work`, `personal`, `shared`).

---

## MCP Tool Reference

### `store_entry`

Store a new memory, context, handoff, or resource entry.

| Parameter        | Type                                                  | Required | Description                                      |
|-----------------|-------------------------------------------------------|----------|--------------------------------------------------|
| `title`         | `string`                                              | yes      | Short label for the entry                        |
| `content`       | `string`                                              | yes      | The main content to store (encrypted at rest)    |
| `type`          | `context\|memory\|handoff\|resource`                  | yes      | Entry type                                       |
| `tags`          | `string[]`                                            | no       | Optional tags for filtering                      |
| `namespace`     | `string`                                              | no       | Scope entries (e.g. `work`, `personal`, `shared`)|
| `pinned`        | `boolean`                                             | no       | Mark as pinned (surfaced by `get_pinned_context`)|
| `resource_name` | `string`                                              | no       | For `type: resource` — resource identifier name  |
| `resource_location` | `string`                                          | no       | For `type: resource` — URI or path               |
| `confirmed`     | `boolean`                                             | no       | Mark as confirmed fact (asserted confidently)    |

---

### `search_memory`

Semantic search across stored entries using Vectorize.

| Parameter    | Type     | Required | Description                                          |
|-------------|----------|----------|------------------------------------------------------|
| `query`     | `string` | yes      | Natural language search query                        |
| `type`      | `string` | no       | Filter by entry type                                 |
| `namespace` | `string` | no       | Limit results to a specific namespace                |
| `limit`     | `number` | no       | Max results to return (default: 10)                  |

---

### `get_handoffs`

Retrieve all active handoff entries (status: `needs_action`). Call at the start of a work session for continuity.

| Parameter    | Type     | Required | Description                                          |
|-------------|----------|----------|------------------------------------------------------|
| `namespace` | `string` | no       | Filter handoffs to a specific namespace              |

---

### `archive_handoff`

Mark a handoff as actioned after you have acted on it.

| Parameter | Type     | Required | Description                  |
|----------|----------|----------|------------------------------|
| `id`     | `string` | yes      | ID of the handoff to archive |

---

### `update_entry`

Update fields of an existing entry.

| Parameter       | Type      | Required | Description                                      |
|----------------|-----------|----------|--------------------------------------------------|
| `id`           | `string`  | yes      | ID of the entry to update                        |
| `title`        | `string`  | no       | New title                                        |
| `content`      | `string`  | no       | New content (re-encrypted + re-embedded on change)|
| `tags`         | `string[]`| no       | New tags                                         |
| `namespace`    | `string`  | no       | Move entry to a different namespace              |
| `pinned`       | `boolean` | no       | Set or unset pinned flag                         |
| `confirmed_at` | `string`  | no       | ISO 8601 timestamp of confirmation               |

---

### `delete_entry`

Permanently delete an entry by ID. Removes from both D1 and Vectorize.

| Parameter | Type     | Required | Description                  |
|----------|----------|----------|------------------------------|
| `id`     | `string` | yes      | ID of the entry to delete    |

---

## Namespace Scoping

Namespaces allow you to partition your context by project, role, or context. Common patterns:

- `work` — work-related context, handoffs, and memory
- `personal` — personal preferences, life context
- `shared` — entries accessible across contexts

### Session Namespace System Prompt Examples

```
At session start, call get_pinned_context with namespace="work".
Include namespace="work" in all store_entry and search_memory calls.
To query personal entries, omit namespace or use namespace="personal".
```

```
At the start of each work session:
1. Call get_handoffs with namespace="work" to retrieve pending actions.
2. Call search_memory with namespace="work" and the session topic to load relevant context.
3. When storing new entries, always include namespace="work".
```

---

## System Prompt Snippets

### Claude / Claude Code (full context retrieval)

```
You have access to a Limitless MCP server. At the start of each conversation,
call search_memory with the user's topic to retrieve relevant context.
Treat confirmed entries as current facts. Treat unconfirmed entries as
likely-true but verify if the conversation depends on them.
```

### Session continuity (handoff-first)

```
At session start:
1. Call get_handoffs to retrieve any pending work items.
2. Call search_memory with the current topic to load relevant context.
Archive each handoff once you have acted on it via archive_handoff.
```

---

## Entry Types

| Type       | Purpose                                                        |
|-----------|----------------------------------------------------------------|
| `context` | Persistent identity — who you are, how you work, frameworks    |
| `memory`  | Accumulated knowledge — meetings, decisions, client context    |
| `handoff` | Transient actions — where work left off, what's next          |
| `resource`| Named resources — file paths, URIs, tool references            |

---

## Confirmed Flag + Staleness

- Set `confirmed: true` when you've verified an entry is current.
- The AI should assert confirmed entries confidently and hedge unconfirmed ones.
- Fact-type entries (job, location, relationships) are flagged for re-confirmation after ~12–18 months.

---

## Admin Interface

Visit `/admin` on your deployed Worker. Sign in with the same Google account you use for MCP.

**Namespace migration workflow:** Select "Unnamespaced" in the namespace filter to see entries
without a namespace assigned. Use the dropdown on each card to assign a namespace — changes
save immediately via the REST API.

**What you can do:**
- Filter entries by namespace, type, pinned status
- Assign or clear namespace on any entry
- Pin/unpin entries (pinned entries are returned by `get_pinned_context`)
- Delete entries

---

## REST API

The REST API is designed for admin tooling and automation. It uses Bearer token auth — the token
is issued by the OAuth callback at `/admin/callback` and expires after 8 hours.

```
GET    /api/entries            — list entries (filters: namespace, type, status, pinned, limit, offset)
GET    /api/entries/:id        — fetch a single entry (content decrypted)
PATCH  /api/entries/:id        — update fields (namespace, title, tags, pinned, content, confirmed_at)
DELETE /api/entries/:id        — permanently delete from D1 and Vectorize
```

**Auth header:**
```
Authorization: Bearer <token>
```
