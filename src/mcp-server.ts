import { McpAgent } from 'agents/mcp';
// Import McpServer from the same SDK version agents uses internally to avoid type conflicts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { storeEntry, storeEntrySchema } from './tools/store';
import { searchMemory, searchMemorySchema } from './tools/search';
import { getHandoffs, archiveHandoffEntry, archiveHandoffSchema } from './tools/handoffs';
import { deleteEntryTool, deleteEntrySchema } from './tools/delete';
import { updateEntryTool, updateEntrySchema } from './tools/update';

interface AuthProps extends Record<string, unknown> {
  claims: {
    sub: string;
    email: string;
    name: string;
  };
}

export class LimitlessMCP extends McpAgent<Env, unknown, AuthProps> {
  // Cast to any to handle minor version mismatch between top-level and agents-internal SDK
  server = new McpServer({ name: 'Limitless', version: '1.0.0' }) as any;

  async init() {
    const userId = this.props!.claims.sub;

    this.server.tool(
      'store_entry',
      'Store a new memory, context, or handoff entry',
      storeEntrySchema.shape,
      async (input: any) => {
        const result = await storeEntry(this.env, userId, input);
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
        const results = await searchMemory(this.env, userId, input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results) }],
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
          content: [{ type: 'text' as const, text: JSON.stringify(results) }],
        };
      }
    );

    this.server.tool(
      'archive_handoff',
      'Mark a handoff as actioned after you have acted on it',
      archiveHandoffSchema.shape,
      async (input: any) => {
        const result = await archiveHandoffEntry(this.env, userId, input);
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
        const result = await deleteEntryTool(this.env, userId, input);
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
        const result = await updateEntryTool(this.env, userId, input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }
    );
  }
}
