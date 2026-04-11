import { z } from 'zod';
import { insertRelationship, expireRelationship } from '../db/relationships';
import type { RelationshipRow } from '../db/schema';

export const addRelationshipSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  rel_type: z.string(),
  label: z.string().optional(),
});

export const expireRelationshipSchema = z.object({
  id: z.string().uuid(),
});

export async function addRelationshipTool(
  env: Env,
  input: z.infer<typeof addRelationshipSchema>
): Promise<RelationshipRow> {
  return insertRelationship(env.DB, {
    source_id: input.source_id,
    target_id: input.target_id,
    rel_type: input.rel_type,
    label: input.label,
  });
}

export async function expireRelationshipTool(
  env: Env,
  input: z.infer<typeof expireRelationshipSchema>
): Promise<{ success: boolean; message: string }> {
  const expired = await expireRelationship(env.DB, input.id);
  return {
    success: expired,
    message: expired
      ? `Relationship ${input.id} expired`
      : `No relationship found with id ${input.id}`,
  };
}
