import { describe, it, expect, vi } from 'vitest';
import { updateEntryTool } from '../../src/tools/update';

const makeEnv = (entry: object | null) => ({
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(entry) }),
    }),
  },
  VECTORIZE: { upsert: vi.fn().mockResolvedValue({}) },
  AI: { run: vi.fn().mockResolvedValue({ data: [new Array(768).fill(0.1)] }) },
  SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!',
});

describe('updateEntryTool', () => {
  it('accepts namespace and pinned', async () => {
    const existing = { id: 'e1', type: 'context', status: 'active', namespace: null, pinned: 0, content: '' };
    const result = await updateEntryTool(makeEnv(existing) as any, 'u1', 'google', {
      id: 'e1', namespace: 'work', pinned: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts confirmed_at', async () => {
    const existing = { id: 'e1', type: 'memory', status: 'active', namespace: 'work', pinned: 0, content: '' };
    const result = await updateEntryTool(makeEnv(existing) as any, 'u1', 'google', {
      id: 'e1', confirmed_at: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it('returns failure when not found', async () => {
    const result = await updateEntryTool(makeEnv(null) as any, 'u1', 'google', {
      id: 'bad', namespace: 'work',
    });
    expect(result.success).toBe(false);
  });
});
