import { describe, it, expect, vi } from 'vitest';
import { exploreContext } from '../../src/tools/explore';

vi.mock('../../src/crypto', () => ({
  deriveUserKey: vi.fn().mockResolvedValue({} as CryptoKey),
  safeDecrypt: vi.fn().mockImplementation((content: string) => Promise.resolve(content)),
}));

vi.mock('../../src/db/queries', () => ({
  getEntryById: vi.fn(),
}));

vi.mock('../../src/db/relationships', () => ({
  getRelationshipsByEntry: vi.fn(),
}));

import { getEntryById } from '../../src/db/queries';
import { getRelationshipsByEntry } from '../../src/db/relationships';

const makeEntry = (id: string, type: string, namespace: string) => ({
  id, user_id: 'u1', type, status: 'active', title: `Entry ${id}`,
  content: 'content', tags: null, namespace, pinned: 0,
  resource_name: null, resource_location: null, confirmed_at: null,
  supersedes: null, created_at: Date.now(), updated_at: Date.now(),
});

const makeRel = (source_id: string, target_id: string, rel_type: string) => ({
  id: crypto.randomUUID(), source_id, target_id, rel_type,
  label: null, valid_from: Date.now(), valid_to: null, created_at: Date.now(),
});

describe('exploreContext', () => {
  it('returns the root entry and its direct relationships', async () => {
    const entry1 = makeEntry('e1', 'project', 'work');
    const entry2 = makeEntry('e2', 'framework', 'work');
    const rel = makeRel('e1', 'e2', 'uses_framework');

    const mockGetEntry = getEntryById as any;
    mockGetEntry.mockImplementation((_db: any, id: string) => {
      if (id === 'e1') return entry1;
      if (id === 'e2') return entry2;
      return null;
    });

    const mockGetRels = getRelationshipsByEntry as any;
    mockGetRels.mockImplementation((_db: any, entryId: string) => {
      if (entryId === 'e1') return [rel];
      return [];
    });

    const env = { DB: {}, SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!' } as any;

    const result = await exploreContext(env, 'u1', 'google', { entry_id: 'e1', depth: 1, include_expired: false });

    expect(result.root.id).toBe('e1');
    expect(result.related).toHaveLength(1);
    expect(result.related[0].entry.id).toBe('e2');
    expect(result.related[0].relationship.rel_type).toBe('uses_framework');
    expect(result.related[0].direction).toBe('outgoing');
  });

  it('filters out entries from other namespaces without cross_namespace', async () => {
    const entry1 = makeEntry('e1', 'project', 'work');
    const entryPersonal = makeEntry('e3', 'memory', 'personal');
    const rel = makeRel('e1', 'e3', 'related_to');

    const mockGetEntry = getEntryById as any;
    mockGetEntry.mockImplementation((_db: any, id: string) => {
      if (id === 'e1') return entry1;
      if (id === 'e3') return entryPersonal;
      return null;
    });

    const mockGetRels = getRelationshipsByEntry as any;
    mockGetRels.mockImplementation((_db: any, entryId: string) => {
      if (entryId === 'e1') return [rel];
      return [];
    });

    const env = { DB: {}, SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!' } as any;

    const result = await exploreContext(env, 'u1', 'google', {
      entry_id: 'e1', namespace: 'work', depth: 1, include_expired: false,
    });

    const relatedIds = result.related.map((r: any) => r.entry.id);
    expect(relatedIds).not.toContain('e3');
  });

  it('includes cross-namespace entries when cross_namespace is set', async () => {
    const entry1 = makeEntry('e1', 'project', 'work');
    const entryPersonal = makeEntry('e3', 'memory', 'personal');
    const rel = makeRel('e1', 'e3', 'related_to');

    const mockGetEntry = getEntryById as any;
    mockGetEntry.mockImplementation((_db: any, id: string) => {
      if (id === 'e1') return entry1;
      if (id === 'e3') return entryPersonal;
      return null;
    });

    const mockGetRels = getRelationshipsByEntry as any;
    mockGetRels.mockImplementation((_db: any, entryId: string) => {
      if (entryId === 'e1') return [rel];
      return [];
    });

    const env = { DB: {}, SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!' } as any;

    const result = await exploreContext(env, 'u1', 'google', {
      entry_id: 'e1', namespace: 'work', cross_namespace: 'personal', depth: 1, include_expired: false,
    });

    const relatedIds = result.related.map((r: any) => r.entry.id);
    expect(relatedIds).toContain('e3');
  });

  it('throws when entry not found', async () => {
    const mockGetEntry = getEntryById as any;
    mockGetEntry.mockResolvedValue(null);

    const env = { DB: {}, SERVER_ENCRYPTION_SECRET: 'test-secret-minimum-32-characters!' } as any;

    await expect(
      exploreContext(env, 'u1', 'google', { entry_id: 'nonexistent', depth: 1, include_expired: false })
    ).rejects.toThrow('not found');
  });
});
