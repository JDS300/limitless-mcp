import { describe, it, expect, vi } from 'vitest';
import { addRelationshipTool, expireRelationshipTool } from '../../src/tools/relationship';

vi.mock('../../src/db/relationships', () => ({
  insertRelationship: vi.fn().mockResolvedValue({
    id: 'rel-1', source_id: 's1', target_id: 't1', rel_type: 'related_to',
    label: null, valid_from: Date.now(), valid_to: null, created_at: Date.now(),
  }),
  expireRelationship: vi.fn().mockResolvedValue(true),
}));

const mockEnv = { DB: {} } as any;

describe('addRelationshipTool', () => {
  it('creates a relationship and returns it', async () => {
    const result = await addRelationshipTool(mockEnv, {
      source_id: 's1',
      target_id: 't1',
      rel_type: 'uses_framework',
      label: 'Uses Three Patterns',
    });
    expect(result.id).toBe('rel-1');
  });
});

describe('expireRelationshipTool', () => {
  it('expires a relationship by id', async () => {
    const result = await expireRelationshipTool(mockEnv, { id: 'rel-1' });
    expect(result.success).toBe(true);
  });
});
