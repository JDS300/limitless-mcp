import { z } from 'zod';
import { insertRelationship, expireRelationship } from '../db/relationships';
import { getEntryById } from '../db/queries';
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
  user_id: string,
  input: z.infer<typeof addRelationshipSchema>
): Promise<RelationshipRow> {
  // Verify both entries belong to this user
  const source = await getEntryById(env.DB, input.source_id, user_id);
  if (!source) throw new Error(`Source entry ${input.source_id} not found for this user`);
  const target = await getEntryById(env.DB, input.target_id, user_id);
  if (!target) throw new Error(`Target entry ${input.target_id} not found for this user`);

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
