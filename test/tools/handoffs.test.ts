import { describe, it, expect, vi } from 'vitest';
import { getHandoffs, archiveHandoffEntry } from '../../src/tools/handoffs';

const SECRET = 'test-secret-minimum-32-characters!';

const makeDb = (rows: object[] = [], entry: object | null = null) => ({
  prepare: vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: rows }),
      first: vi.fn().mockResolvedValue(entry),
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    }),
  }),
});

describe('getHandoffs', () => {
  it('queries without namespace filter when omitted', async () => {
    const db = makeDb();
    await getHandoffs({ DB: db, SERVER_ENCRYPTION_SECRET: SECRET } as any, 'u1', 'google');
    const sql: string = db.prepare.mock.calls[0][0];
    expect(sql).not.toContain('namespace');
  });

  it('queries with namespace clause when provided', async () => {
    const db = makeDb();
    await getHandoffs({ DB: db, SERVER_ENCRYPTION_SECRET: SECRET } as any, 'u1', 'google', 'work');
    const sql: string = db.prepare.mock.calls[0][0];
    expect(sql).toContain('namespace');
  });
});

describe('archiveHandoffEntry', () => {
  it('includes namespace in Vectorize upsert metadata', async () => {
    const entryRow = { id: 'e1', user_id: 'u1', type: 'handoff', status: 'needs_action', namespace: 'work', pinned: 0, content: '' };
    const db = makeDb([], entryRow);
    const vectorize = { upsert: vi.fn().mockResolvedValue({}) };
    await archiveHandoffEntry(
      { DB: db, VECTORIZE: vectorize, SERVER_ENCRYPTION_SECRET: SECRET } as any,
      'u1', 'google', { id: 'e1' }
    );
    expect(vectorize.upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        metadata: expect.objectContaining({ namespace: 'work' }),
      }),
    ]);
  });
});
