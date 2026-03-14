import { describe, it, expect, vi } from 'vitest';
import { getPinnedContext } from '../../src/tools/pinned';

const SECRET = 'test-secret-minimum-32-characters!';

const makeEnv = (rows: object[]) => ({
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: rows }) }),
    }),
  },
  SERVER_ENCRYPTION_SECRET: SECRET,
});

describe('getPinnedContext', () => {
  it('returns all pinned when no namespace given', async () => {
    const env = makeEnv([{ id: '1', content: '', pinned: 1 }]) as any;
    const result = await getPinnedContext(env, 'u1', 'google', undefined);
    expect(result).toHaveLength(1);
    const sql: string = env.DB.prepare.mock.calls[0][0];
    expect(sql).not.toContain('namespace');
  });

  it('filters by namespace + shared when namespace given', async () => {
    const env = makeEnv([]) as any;
    await getPinnedContext(env, 'u1', 'google', 'work');
    const sql: string = env.DB.prepare.mock.calls[0][0];
    expect(sql).toContain('namespace');
    expect(sql).toContain('shared');
  });
});
