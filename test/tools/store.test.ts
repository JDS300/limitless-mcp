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
      type: 'memory',
      content: 'I work at Intrust',
      namespace: 'work',
    });
    expect(env.VECTORIZE.upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        metadata: expect.objectContaining({ namespace: 'work' }),
      }),
    ]);
  });

  it('omits namespace from Vectorize metadata when not provided', async () => {
    const env = mockEnv() as any;
    await storeEntry(env, 'user1', 'google', { type: 'memory', content: 'A fact' });
    const metadata = env.VECTORIZE.upsert.mock.calls[0][0][0].metadata;
    expect(metadata).not.toHaveProperty('namespace');
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

  it('accepts V3 domain types', async () => {
    const v3Types = ['identity', 'rules', 'catalog', 'framework', 'decision', 'project', 'handoff'] as const;
    for (const type of v3Types) {
      const env = mockEnv() as any;
      const result = await storeEntry(env, 'user1', 'google', {
        type,
        content: `Content for ${type}`,
      });
      expect(result.id).toBeDefined();
      expect(result.message).toContain(type);
    }
  });

  it('stores supersedes field for decision entries', async () => {
    const env = mockEnv() as any;
    const supersededId = '00000000-0000-0000-0000-000000000001';
    await storeEntry(env, 'user1', 'google', {
      type: 'decision',
      content: 'We switched from REST to GraphQL',
      supersedes: supersededId,
    });
    // The DB prepare().bind() should have been called with supersededId somewhere in the args
    const bindCalls = env.DB.prepare.mock.results.flatMap((r: any) =>
      r.value.bind.mock.calls.flat()
    );
    expect(bindCalls).toContain(supersededId);
  });

  it('creates relationships when provided', async () => {
    const env = mockEnv() as any;
    const targetId = '00000000-0000-0000-0000-000000000002';
    await storeEntry(env, 'user1', 'google', {
      type: 'project',
      content: 'My project entry',
      relationships: [{ target_id: targetId, rel_type: 'depends_on', label: 'depends on auth service' }],
    });
    // insertRelationship calls DB.prepare with an INSERT INTO relationships statement
    const prepareCalls: string[] = env.DB.prepare.mock.calls.map((c: any[]) => c[0] as string);
    const relInsert = prepareCalls.find((sql) => sql.includes('relationships'));
    expect(relInsert).toBeDefined();
    // target_id should appear in bind args
    const bindCalls = env.DB.prepare.mock.results.flatMap((r: any) =>
      r.value.bind.mock.calls.flat()
    );
    expect(bindCalls).toContain(targetId);
  });
});
