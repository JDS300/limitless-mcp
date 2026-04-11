import { describe, it, expect, vi } from 'vitest';
import {
  insertRelationship,
  getRelationshipsByEntry,
  expireRelationship,
  deleteRelationshipsByEntry,
} from '../../src/db/relationships';

const mockDb = () => {
  const rows: any[] = [];
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        all: vi.fn().mockResolvedValue({ results: rows }),
        first: vi.fn().mockResolvedValue(rows[0] ?? null),
      }),
    }),
    _rows: rows,
  };
};

describe('insertRelationship', () => {
  it('inserts a relationship with valid_from set to now', async () => {
    const db = mockDb() as any;
    const rel = await insertRelationship(db, {
      source_id: 'entry-1',
      target_id: 'entry-2',
      rel_type: 'uses_framework',
      label: 'Uses Three Patterns',
    });
    expect(rel.id).toBeDefined();
    expect(db.prepare).toHaveBeenCalled();
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO relationships');
  });
});

describe('getRelationshipsByEntry', () => {
  it('queries both source and target directions', async () => {
    const db = mockDb() as any;
    await getRelationshipsByEntry(db, 'entry-1');
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('source_id = ?');
    expect(sql).toContain('target_id = ?');
  });

  it('filters to current relationships by default', async () => {
    const db = mockDb() as any;
    await getRelationshipsByEntry(db, 'entry-1');
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('valid_to IS NULL');
  });

  it('includes expired relationships when requested', async () => {
    const db = mockDb() as any;
    await getRelationshipsByEntry(db, 'entry-1', { includeExpired: true });
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).not.toContain('valid_to IS NULL');
  });
});

describe('expireRelationship', () => {
  it('sets valid_to to current timestamp', async () => {
    const db = mockDb() as any;
    await expireRelationship(db, 'rel-1');
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('valid_to = ?');
    expect(sql).toContain('WHERE id = ?');
  });
});

describe('deleteRelationshipsByEntry', () => {
  it('deletes all relationships referencing the entry', async () => {
    const db = mockDb() as any;
    await deleteRelationshipsByEntry(db, 'entry-1');
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('DELETE FROM relationships');
    expect(sql).toContain('source_id = ?');
    expect(sql).toContain('target_id = ?');
  });
});
