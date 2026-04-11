import { describe, it, expect, vi } from 'vitest';
import { handleBulkImport } from '../../src/api/bulk';

vi.mock('../../src/tools/store', () => ({
  storeEntry: vi.fn().mockResolvedValue({ id: 'new-id', message: 'stored' }),
}));

describe('bulk import API', () => {
  it('accepts an array of entries and returns summary', async () => {
    const req = new Request('https://test/api/entries/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: [
          { type: 'identity', content: 'I am JD', namespace: 'work' },
          { type: 'rules', content: 'Always search first', namespace: 'work' },
        ],
      }),
    });
    const res = await handleBulkImport(req, {} as any, 'user-1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(2);
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);
  });

  it('returns 400 for non-array body', async () => {
    const req = new Request('https://test/api/entries/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'identity', content: 'test' }),
    });
    const res = await handleBulkImport(req, {} as any, 'user-1');
    expect(res.status).toBe(400);
  });

  it('handles individual entry failures gracefully', async () => {
    const { storeEntry } = await import('../../src/tools/store');
    (storeEntry as any)
      .mockResolvedValueOnce({ id: 'ok-1', message: 'stored' })
      .mockRejectedValueOnce(new Error('bad entry'));

    const req = new Request('https://test/api/entries/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: [
          { type: 'identity', content: 'good', namespace: 'work' },
          { type: 'identity', content: '', namespace: 'work' },
        ],
      }),
    });
    const res = await handleBulkImport(req, {} as any, 'user-1');
    const body = await res.json() as any;
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
  });
});
