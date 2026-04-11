# Limitless V3 — Context Engine

**Date:** 2026-04-11
**Status:** Design approved
**Scope:** Evolve limitless-mcp from a supplementary memory store into the primary knowledge layer that replaces file-based context systems across any AI, any device, any application.

---

## Problem

AI context systems built on local markdown files (CLAUDE.md, CONTEXT.md, SERVICE_CATALOG.md, DECISIONS_LOG.md, per-project CONTEXT.md) hit a scaling wall. As projects, decisions, and context accumulate:

- The prompt fills up and the model starts hallucinating or missing information
- Context is locked to a single device and a single AI application
- There is no progressive loading — everything is dumped at session start
- Cross-project relationships are invisible without manual cross-referencing
- No temporal awareness — facts that were true six months ago and facts that are true now look identical

Limitless V3 solves this by becoming the AI-agnostic organizational brain: structured domain-typed entries, a relationship graph for traversal, progressive loading via bootstrap + on-demand search, and hard namespace isolation between work and personal contexts.

---

## Goals

1. Replace all file-based context with limitless-served entries — the only file on disk is a thin CLAUDE.md bootstrap stub and deliverable outputs (proposals, SOWs, presentations)
2. Work across any MCP-capable client (Claude Code, Cowork, web chat, desktop, mobile) and any AI via the REST API
3. Load minimal context at session start (~800-1500 tokens) and retrieve deeper knowledge on demand
4. Enable relationship traversal — "everything related to Client XYZ" without knowing what to search for
5. Enforce namespace isolation so personal and work context never bleed unless explicitly requested
6. Provide a flexible import path for any vault structure, not just the AI Vault pattern

---

## Design

### 1. Domain Model

The current 4 entry types (`context`, `memory`, `handoff`, `resource`) expand to 9 domain types. The `type` column in the entries table accepts these values:

| Domain | Purpose | Replaces | Typical pinned? |
|--------|---------|----------|----------------|
| `identity` | Who the user is, role, org, style preferences, banned language patterns | CLAUDE.md identity sections | Always |
| `rules` | Behavioral directives — read order, guardrails, pushback instructions, consistency checks | CLAUDE.md behavioral rules | Always |
| `catalog` | Individual service offerings with pricing, descriptions, inclusions | SERVICE_CATALOG.md (split into one entry per offering) | No — searched on demand |
| `framework` | Individual methodologies, models, repeatable approaches | FRAMEWORKS.md (split into one entry per framework) | No — searched on demand |
| `decision` | Individual decisions with date, rationale, and optional supersedes link | DECISIONS_LOG.md (split into one entry per decision) | Recent/important ones only |
| `project` | Project status, goals, client, phase, key deliverables | Per-project CONTEXT.md | Active projects pinned |
| `handoff` | Cross-session tasks, follow-ups, flagged items | Same as V2 | needs_action items surfaced at bootstrap |
| `resource` | Templates, prompts, URIs, reusable artifacts | Same as V2 | No — deterministic lookup |
| `memory` | Catch-all for anything that doesn't fit the above domains | Generic memory entries | Varies |

**Key behaviors:**

- `identity` and `rules` entries are always pinned. They are small, stable, and form the "Layer 0" that every session needs.
- `project` entries for active projects are pinned. When a project completes, it is unpinned but remains searchable.
- `catalog` and `framework` entries are never bulk-loaded. They are retrieved on demand when pricing or methodology questions arise. This is the primary mechanism for keeping bootstrap token count low.
- `decision` entries gain a `supersedes` field — a nullable reference to the ID of the decision being overridden. When a new decision contradicts an old one, the old one is explicitly linked. This prevents relitigating past decisions and provides a clear audit chain.
- `memory` is the catch-all. If a pattern emerges where many similar `memory` entries are being stored, that signals a new domain type should be promoted.

**Migration from V2 types:**

| V2 type | V3 mapping |
|---------|-----------|
| `context` | Reclassified to `identity`, `rules`, or `project` depending on content |
| `memory` | Reclassified to `decision`, `framework`, or stays as `memory` |
| `handoff` | Unchanged |
| `resource` | Unchanged |

A migration tool (admin action or import prompt) handles reclassification. Existing entries continue to work during the transition — the system treats unrecognized types as `memory` until reclassified.

### 2. Relationship Graph

A new `relationships` table in D1 tracks typed, directional, temporal edges between entries.

**Schema:**

```sql
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

**Starting relationship types:**

| rel_type | Direction | Meaning | Example |
|----------|-----------|---------|---------|
| `uses_framework` | project/resource → framework | Work product uses a methodology | Client proposal → Three Patterns |
| `priced_from` | project/resource → catalog | Pricing sourced from catalog entry | SOW → AI Workshop $5,000 |
| `decided_by` | any → decision | Shaped by a specific decision | Project scope → Decision entry |
| `supersedes` | decision → decision | Newer decision replaces older one | Decision B → Decision A |
| `delivered_to` | resource → project | Work product associated with a project | Proposal doc → Client XYZ project |
| `related_to` | any → any | General association (catch-all edge) | Any → Any |

Relationship types are extensible — new `rel_type` values can be added without schema changes.

**Temporal validity:**

- `valid_from` (required): Unix ms timestamp when the relationship became true
- `valid_to` (nullable): Unix ms timestamp when the relationship was invalidated. NULL means currently valid.
- When a fact changes (e.g., pricing update), the old edge gets `valid_to = now()` and a new edge is created with current values. Both remain queryable for historical context.
- Queries default to `valid_to IS NULL` (current relationships only). An optional `include_expired: true` parameter returns the full history.

**How relationships are created:**

- `store_entry` and `update_entry` gain an optional `relationships` parameter — an array of `{target_id, rel_type, label}`. Edges are created atomically with the entry.
- A dedicated `add_relationship(source_id, target_id, rel_type, label)` tool creates edges after the fact.
- An `expire_relationship(id)` tool sets `valid_to = now()` on an existing edge.
- Claude creates relationships conversationally as part of normal work — when storing a proposal, it links to the framework used, the pricing source, and the decisions that shaped it.

**Namespace enforcement on traversal:**

- Edges do not have their own namespace. They inherit namespace from the entries they connect.
- During traversal, the query respects the session namespace: if the session is `work`, any edge where source or target has namespace `personal` is skipped unless `cross_namespace` is explicitly set.
- This is enforced at the query layer — the `explore_context` tool filters results after traversal, not before (to avoid missing paths through `shared` entries that connect to valid entries).

### 3. Bootstrap Protocol

A single `bootstrap_session(namespace)` tool call replaces reading multiple context files at session start.

**What it returns (in order):**

1. **Identity** (pinned, domain: identity) — name, role, org, style preferences, banned language. ~100-200 tokens.
2. **Rules** (pinned, domain: rules) — behavioral directives, guardrails, consistency checks, pushback instructions. ~200-400 tokens.
3. **Active projects** (pinned, domain: project) — summary of each active project: name, client, phase, key context. ~200-500 tokens.
4. **Pending handoffs** (domain: handoff, status: needs_action) — cross-session tasks and flagged items. ~100-300 tokens.
5. **Recent decisions** (domain: decision, last 30 days, pinned or high-importance) — titles, dates, and one-line rationale. ~100-200 tokens.

**Total bootstrap cost:** ~700-1600 tokens. Compare to potentially thousands of tokens from reading multiple markdown files.

**What stays out of bootstrap (retrieved on demand):**

- Full catalog/pricing → `search_memory(query, domain: "catalog")`
- Frameworks → `search_memory(query, domain: "framework")`
- Completed project history → `search_memory(query, domain: "project")`
- Older decisions → `search_memory(query, domain: "decision")`
- Full relationship context → `explore_context(entry_id)`

**The thin CLAUDE.md:**

```markdown
# Session Bootstrap
Call bootstrap_session with the appropriate namespace before any task.
Use limitless-mcp for all context — do not assert facts without searching.
Deliverables are saved to the local vault folder structure.
Cross-namespace writes go through handoffs, never direct mutations.
```

This is the only file that needs to exist on disk per workspace. Everything else lives in limitless.

### 4. New and Modified MCP Tools

**New tools:**

| Tool | Purpose |
|------|---------|
| `bootstrap_session(namespace)` | Aggregates pinned entries by domain in prescribed order. Returns structured session context. |
| `explore_context(entry_id, rel_type?, depth?, cross_namespace?)` | Walks relationship graph from a starting entry. Returns connected entries with edge labels and temporal validity. |
| `add_relationship(source_id, target_id, rel_type, label)` | Creates a relationship edge between two entries. |
| `expire_relationship(id)` | Sets `valid_to = now()` on an existing relationship. |

**Modified tools:**

| Tool | Changes |
|------|---------|
| `store_entry` | `type` accepts 9 domain values. New optional `relationships` array parameter. `namespace` becomes required (not optional). New optional `supersedes` field for decision entries. |
| `update_entry` | Can add/expire relationships. Can update `supersedes`. Re-embeds on content change (unchanged from V2). |
| `delete_entry` | Cascade-deletes associated relationships (handled by FK ON DELETE CASCADE). |
| `search_memory` | New optional `domain` filter parameter (replaces `type` filter or aliases to it). Filters Vectorize metadata by domain. |
| `get_pinned_context` | Deprecated in favor of `bootstrap_session`. Kept for backward compatibility but `bootstrap_session` is the recommended path. |

**Unchanged tools:**

| Tool | Notes |
|------|-------|
| `get_handoffs` | Unchanged. Bootstrap calls it internally. |
| `archive_handoff` | Unchanged. |
| `get_resource` | Unchanged. Deterministic name/tag lookup. |

### 5. Namespace Enforcement

Namespace becomes a hard boundary, not a soft filter.

**Write rules:**

| Scenario | Behavior |
|----------|----------|
| Write to current session namespace | Direct. No friction. |
| Write to `shared` namespace | Direct. Shared is accessible from all namespaces. |
| Write targeting a different namespace | Creates a handoff in the target namespace. Never a direct mutation. |
| Write with no namespace specified | Rejected. Namespace is required on all writes (breaking change from V2). |

**Read rules:**

| Tool | Default behavior | With cross_namespace |
|------|-----------------|---------------------|
| `bootstrap_session` | Session namespace + shared only | Not available. Bootstrap is single-namespace. |
| `search_memory` | Session namespace + shared | Adds specified namespace to search filter. Results tagged with source namespace. |
| `explore_context` | Traversal within session namespace + shared | Follows edges into specified namespace. Results tagged. |
| `get_resource` | Session namespace + shared | Adds specified namespace. |
| `get_handoffs` | Session namespace + shared | Not available. Handoffs are namespace-scoped. |

**Cross-namespace reads are read-only.** No metadata updates, no `last_accessed` changes, no relationship edges created on the target entry. The read happened in the session's conversation context, which is ephemeral.

**Cross-namespace relationship linking** is possible but only when the user explicitly requests it (e.g., "link this personal project to my work with Client XYZ"). Both entries keep their original namespace. The edge is visible from both sides when `cross_namespace` is enabled on read.

### 6. Migration and Import

Three import paths, all prompt-driven and structure-agnostic.

**Path 1: AI Vault structured import**

For vaults using the CLAUDE.md / CONTEXT.md / SERVICE_CATALOG.md pattern. Content is already AI-ready — the job is mapping to domains, not interpreting.

| Source File | Target Domain | Namespace | Notes |
|-------------|--------------|-----------|-------|
| CLAUDE.md (identity) | `identity` | per user | Style prefs, who you are |
| CLAUDE.md (rules) | `rules` | per user | Behavioral directives |
| CONTEXT.md | `project` | per user | Universe overview → pinned summary |
| SERVICE_CATALOG.md | `catalog` (one per offering) | per user | Split into individual entries |
| FRAMEWORKS.md | `framework` (one per framework) | per user | Split into individual entries |
| DECISIONS_LOG.md | `decision` (one per decision) | per user | Each with date, rationale, supersedes links |
| Per-project CONTEXT.md | `project` | per user | Active = pinned, completed = unpinned |

**Path 2: Organic vault import**

For unstructured vaults (Obsidian personal vaults, note collections, etc.). No assumed structure. The import prompt reads content, classifies by domain, and proposes categorization for user review.

Process:
1. Claude reads the vault contents
2. Claude proposes classification: "here's what I found, here's how I'd categorize it, here's what I'd skip"
3. User reviews and adjusts — "that's actually a decision not a framework," "skip that folder," "all of this is personal"
4. Import executes with confirmed classifications
5. Verification prompt catches anything that looks wrong

What to skip by default: raw session transcripts, blog drafts and published posts, daily journal entries, archived content, templates (unless they're reusable prompts).

**Path 3: Cross-AI memory import**

For users migrating context from ChatGPT, Gemini, Copilot, or other AI services. Uses a prompt that guides the user to export their conversation context and maps it to limitless domain types. No file upload required — prompt-driven, structured output, bulk import.

**Import tooling:**

- Import prompts stored as `resource` entries in limitless (self-hosted, retrievable via `get_resource`)
- `POST /api/entries/bulk` endpoint accepts a JSON array of entries with optional `relationships` arrays
- Returns summary: total attempted, succeeded, failed with reasons
- Post-import verification prompt (also stored as a resource) reviews imported content for duplicates, stale entries, and misclassifications

**Relationship creation during import:**

The import prompts instruct Claude to identify connections between entries as they're classified. When a decision references a framework, or a project references pricing, those edges are created as part of the import batch. This seeds the relationship graph with initial structure rather than starting from zero.

### 7. Schema Changes

**Migration 0003_v3_schema.sql:**

```sql
-- Expand type values (no column change needed — type is TEXT)
-- Add supersedes column to entries
ALTER TABLE entries ADD COLUMN supersedes TEXT REFERENCES entries(id);

-- Create relationships table
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

**Vectorize metadata changes:**

The `type` metadata field in Vectorize now accepts the expanded domain values. No index rebuild needed — Vectorize metadata filtering uses string matching.

### 8. REST API Changes

**New endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/entries/bulk` | Bulk import entries with optional relationships |
| `GET` | `/api/entries/:id/relationships` | List relationships for an entry |
| `POST` | `/api/relationships` | Create a relationship |
| `PATCH` | `/api/relationships/:id` | Update (typically expire) a relationship |
| `DELETE` | `/api/relationships/:id` | Delete a relationship |

**Modified endpoints:**

- `GET /api/entries` gains `domain` query parameter (aliases `type`)
- `PATCH /api/entries/:id` accepts `relationships` array for atomic edge creation

### 9. Admin UI Changes

Minimal additions to support the new model:

- Filter by domain type (expanded dropdown with 9 values)
- Filter by namespace
- View relationships for an entry (expandable panel showing edges with labels and validity)
- Bulk select with bulk delete (for post-import cleanup)
- Visual indicator for pinned entries
- Visual indicator for superseded decisions

No new pages — all additions are filters and inline panels on the existing entries view.

---

## What This Does Not Include

- **No continuous vault sync.** Import is a one-time bootstrap. After that, Claude maintains limitless conversationally. Vaults are for files (deliverables), limitless is for knowledge.
- **No automatic relationship discovery.** Relationships are created explicitly by Claude during entry creation/update or via the dedicated tool. Automated graph inference is a future consideration.
- **No full-text search.** Search remains semantic (Vectorize). Domain filtering improves precision but the search mechanism is unchanged.
- **No entry versioning.** Entries are updated in place. The relationship graph's temporal validity and the decision `supersedes` chain provide historical context where needed. Full entry version history is a future consideration.
- **No AAAK or compression format.** Entries are stored as natural language. Compression is premature at current scale.

---

## Success Criteria

1. A new session starts with a single `bootstrap_session` call returning under 1600 tokens
2. All context previously in markdown files is retrievable via `search_memory` with domain filtering
3. `explore_context` can traverse from any entry to all related entries across domains
4. Cross-namespace reads work without contaminating the target namespace
5. Cross-namespace writes route through handoffs
6. An existing AI Vault can be fully imported via the structured import prompt
7. An existing Obsidian vault can be imported via the organic import prompt with user-guided classification
8. The thin CLAUDE.md bootstrap stub is under 10 lines
