import { McpAgent } from 'agents/mcp';
// Import McpServer from the same SDK version agents uses internally to avoid type conflicts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { storeEntry, storeEntrySchema } from './tools/store';
import { searchMemory, searchMemorySchema } from './tools/search';
import { getHandoffs, archiveHandoffEntry, archiveHandoffSchema, getHandoffsSchema } from './tools/handoffs';
import { deleteEntryTool, deleteEntrySchema } from './tools/delete';
import { updateEntryTool, updateEntrySchema } from './tools/update';
import { getPinnedContext, getPinnedContextSchema } from './tools/pinned';
import { getResource, getResourceSchema } from './tools/resource';
import { bootstrapSession, bootstrapSessionSchema } from './tools/bootstrap';
import { exploreContext, exploreContextSchema } from './tools/explore';
import { addRelationshipTool, addRelationshipSchema, expireRelationshipTool, expireRelationshipSchema } from './tools/relationship';

interface AuthProps extends Record<string, unknown> {
  claims: {
    sub: string;
    email: string;
    name: string;
    provider: string;
  };
}

export class LimitlessMCP extends McpAgent<Env, unknown, AuthProps> {
  // Cast to any to handle minor version mismatch between top-level and agents-internal SDK
  server = new McpServer({ name: 'Limitless', version: '1.0.0' }) as any;

  async init() {
    const userId = this.props!.claims.sub;
    const provider = this.props!.claims.provider ?? 'google';

    this.server.tool(
      'store_entry',
      'Store a new memory, context, or handoff entry',
      storeEntrySchema.shape,
      async (input: any) => {
        const result = await storeEntry(this.env, userId, provider, input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }
    );

    this.server.tool(
      'search_memory',
      'Semantic search across your stored entries',
      searchMemorySchema.shape,
      async (input: any) => {
        const results = await searchMemory(this.env, userId, provider, input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results) }],
        };
      }
    );

    this.server.tool(
      'get_handoffs',
      'Retrieve all active handoff entries (call at the start of a work session)',
      getHandoffsSchema.shape,
      async (input: any) => {
        const results = await getHandoffs(this.env, userId, provider, input.namespace);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results) }],
        };
      }
    );

    this.server.tool(
      'archive_handoff',
      'Mark a handoff as actioned after you have acted on it',
      archiveHandoffSchema.shape,
      async (input: any) => {
        const result = await archiveHandoffEntry(this.env, userId, provider, input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }
    );

    this.server.tool(
      'delete_entry',
      'Permanently delete an entry by ID',
      deleteEntrySchema.shape,
      async (input: any) => {
        const result = await deleteEntryTool(this.env, userId, provider, input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }
    );

    this.server.tool(
      'update_entry',
      'Update tags or content of an existing entry',
      updateEntrySchema.shape,
      async (input: any) => {
        const result = await updateEntryTool(this.env, userId, provider, input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }
    );

    this.server.tool(
      'get_pinned_context',
      'Retrieve all pinned (always-on) entries. Call at session start with your session namespace to load persistent context.',
      getPinnedContextSchema.shape,
      async (input: any) => {
        const results = await getPinnedContext(this.env, userId, provider, input.namespace);
        return { content: [{ type: 'text' as const, text: JSON.stringify(results) }] };
      }
    );

    this.server.tool(
      'get_resource',
      'Retrieve stored resources by name or tag. Resources are prompts, templates, and other reusable artifacts.',
      getResourceSchema.shape,
      async (input: any) => {
        const result = await getResource(this.env, userId, provider, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
    );

    this.server.tool(
      'bootstrap_session',
      'Load session context: identity, rules, active projects, pending handoffs, and recent decisions. Call this at session start with your namespace.',
      bootstrapSessionSchema.shape,
      async (input: any) => {
        const result = await bootstrapSession(this.env, userId, provider, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
    );

    this.server.tool(
      'explore_context',
      'Walk the relationship graph from an entry to find all connected context. Use this to pull everything related to a client, project, or decision.',
      exploreContextSchema.shape,
      async (input: any) => {
        const result = await exploreContext(this.env, userId, provider, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
    );

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
  }
}
