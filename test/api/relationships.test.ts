import { describe, it, expect, vi } from 'vitest';
import { handleRelationshipsRequest } from '../../src/api/relationships';

vi.mock('../../src/db/relationships', () => ({
  getRelationshipsByEntry: vi.fn().mockResolvedValue([
    { id: 'r1', source_id: 's1', target_id: 't1', rel_type: 'related_to', label: null, valid_from: 1000, valid_to: null, created_at: 1000 },
  ]),
  insertRelationship: vi.fn().mockResolvedValue({
    id: 'rel-1', source_id: 's1', target_id: 't1', rel_type: 'related_to',
    label: null, valid_from: Date.now(), valid_to: null, created_at: Date.now(),
  }),
  expireRelationship: vi.fn().mockResolvedValue(true),
}));

describe('relationships API', () => {
  it('GET /api/entries/:id/relationships returns relationships', async () => {
    const req = new Request('https://test/api/entries/e1/relationships');
    const res = await handleRelationshipsRequest(req, {} as any, 'user-1', undefined, 'e1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toHaveLength(1);
  });

  it('POST /api/relationships creates a relationship', async () => {
    const req = new Request('https://test/api/relationships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: 's1', target_id: 't1', rel_type: 'related_to' }),
    });
    const res = await handleRelationshipsRequest(req, {} as any, 'user-1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe('rel-1');
  });

  it('PATCH /api/relationships/:id expires a relationship', async () => {
    const req = new Request('https://test/api/relationships/rel-1', { method: 'PATCH' });
    const res = await handleRelationshipsRequest(req, {} as any, 'user-1', 'rel-1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST without required fields returns 400', async () => {
    const req = new Request('https://test/api/relationships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: 's1' }),
    });
    const res = await handleRelationshipsRequest(req, {} as any, 'user-1');
    expect(res.status).toBe(400);
  });
});
