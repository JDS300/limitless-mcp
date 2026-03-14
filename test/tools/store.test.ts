import { describe, it, expect, vi } from 'vitest';
import { storeEntry } from '../../src/tools/store';

const mockEnv = () => ({
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({ success: true }) }),
    }),
  },
  VECTORIZE: { upsert: vi.fn().mockResolvedValue({}) },
  AI: { run: vi.fn().mockResolvedValue({ data: [new Array(768).fill(0.1)] }) },
  SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!',
});

describe('storeEntry', () => {
  it('includes namespace in Vectorize metadata', async () => {
    const env = mockEnv() as any;
    await storeEntry(env, 'user1', 'google', {
      type: 'context',
      content: 'I work at Intrust',
      namespace: 'work',
    });
    expect(env.VECTORIZE.upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        metadata: expect.objectContaining({ namespace: 'work' }),
      }),
    ]);
  });

  it('defaults namespace to null when not provided', async () => {
    const env = mockEnv() as any;
    await storeEntry(env, 'user1', 'google', { type: 'memory', content: 'A fact' });
    expect(env.VECTORIZE.upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        metadata: expect.objectContaining({ namespace: null }),
      }),
    ]);
  });

  it('accepts resource type with resource_name', async () => {
    const env = mockEnv() as any;
    const result = await storeEntry(env, 'user1', 'google', {
      type: 'resource',
      content: 'prompt text',
      resource_name: 'em-dash-thumbnail-prompt',
      resource_location: 'vault://Prompts/Em-Dash.md',
    });
    expect(result.id).toBeDefined();
  });
});
