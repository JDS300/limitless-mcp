import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchMemory } from '../../src/tools/search';

vi.mock('../../src/embeddings', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
}));

const makeEnv = (matches: { id: string }[]) => ({
  VECTORIZE: {
    query: vi.fn().mockResolvedValue({ matches }),
  },
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) }),
    }),
  },
  AI: { run: vi.fn().mockResolvedValue({ data: [new Array(768).fill(0.1)] }) },
  SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!',
});

describe('searchMemory namespace filtering', () => {
  it('passes namespace $in filter when namespace provided', async () => {
    const env = makeEnv([]) as any;
    await searchMemory(env, 'u1', 'google', { query: 'test', namespace: 'work', limit: 5 });
    expect(env.VECTORIZE.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: expect.objectContaining({
          namespace: { $in: ['work', 'shared'] },
        }),
      })
    );
  });

  it('omits namespace filter when not provided', async () => {
    const env = makeEnv([]) as any;
    await searchMemory(env, 'u1', 'google', { query: 'test', limit: 5 });
    const filter = env.VECTORIZE.query.mock.calls[0][1].filter;
    expect(filter).not.toHaveProperty('namespace');
  });
});
