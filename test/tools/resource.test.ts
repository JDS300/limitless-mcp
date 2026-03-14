import { describe, it, expect, vi } from 'vitest';
import { getResource } from '../../src/tools/resource';

const makeEnv = (rows: object[]) => ({
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: rows }) }),
    }),
  },
  SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!',
});

describe('getResource', () => {
  it('returns error object when neither name nor tag provided', async () => {
    const env = makeEnv([]) as any;
    const result = await getResource(env, 'u1', 'google', {});
    expect(result).toEqual({
      success: false,
      message: "At least one of 'name' or 'tag' is required",
    });
  });

  it('queries by resource_name when name provided', async () => {
    const env = makeEnv([{ id: '1', content: '', resource_name: 'em-dash' }]) as any;
    const result = await getResource(env, 'u1', 'google', { name: 'em-dash' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('uses LIKE when tag provided', async () => {
    const env = makeEnv([]) as any;
    await getResource(env, 'u1', 'google', { tag: 'prompts' });
    const sql: string = env.DB.prepare.mock.calls[0][0];
    expect(sql).toContain('LIKE');
  });
});
