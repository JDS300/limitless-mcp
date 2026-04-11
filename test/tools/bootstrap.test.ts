import { describe, it, expect, vi } from 'vitest';
import { bootstrapSession } from '../../src/tools/bootstrap';

vi.mock('../../src/crypto', () => ({
  deriveUserKey: vi.fn().mockResolvedValue({} as CryptoKey),
  safeDecrypt: vi.fn().mockImplementation((content: string) => Promise.resolve(content)),
}));

const makeRow = (overrides: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  user_id: 'u1',
  type: 'memory',
  status: 'active',
  title: null,
  content: 'test content',
  tags: null,
  namespace: 'work',
  pinned: 1,
  resource_name: null,
  resource_location: null,
  confirmed_at: null,
  supersedes: null,
  created_at: Date.now(),
  updated_at: Date.now(),
  ...overrides,
});

const makeMockDb = (rows: any[]) => ({
  prepare: vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: rows }),
    }),
  }),
});

describe('bootstrapSession', () => {
  it('requires namespace parameter', async () => {
    const env = { DB: makeMockDb([]), SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!' } as any;
    await expect(
      bootstrapSession(env, 'u1', 'google', { namespace: 'work' })
    ).resolves.toBeDefined();
  });

  it('returns entries grouped by domain in prescribed order', async () => {
    const rows = [
      makeRow({ type: 'identity', title: 'Who I am' }),
      makeRow({ type: 'rules', title: 'My rules' }),
      makeRow({ type: 'project', title: 'Active project', pinned: 1 }),
      makeRow({ type: 'handoff', title: 'Follow up', status: 'needs_action', pinned: 0 }),
      makeRow({ type: 'decision', title: 'Recent decision', pinned: 0 }),
    ];
    const env = { DB: makeMockDb(rows), SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!' } as any;
    const result = await bootstrapSession(env, 'u1', 'google', { namespace: 'work' });

    expect(result.sections).toHaveLength(5);
    expect(result.sections[0].domain).toBe('identity');
    expect(result.sections[1].domain).toBe('rules');
    expect(result.sections[2].domain).toBe('project');
    expect(result.sections[3].domain).toBe('handoff');
    expect(result.sections[4].domain).toBe('decision');
  });

  it('omits empty sections', async () => {
    const rows = [
      makeRow({ type: 'identity', title: 'Who I am' }),
    ];
    const env = { DB: makeMockDb(rows), SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!' } as any;
    const result = await bootstrapSession(env, 'u1', 'google', { namespace: 'work' });

    const domains = result.sections.map((s: any) => s.domain);
    expect(domains).toContain('identity');
    expect(domains).not.toContain('rules');
    expect(domains).not.toContain('project');
  });

  it('returns the requested namespace in result', async () => {
    const env = { DB: makeMockDb([]), SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!' } as any;
    const result = await bootstrapSession(env, 'u1', 'google', { namespace: 'personal' });
    expect(result.namespace).toBe('personal');
  });
});
