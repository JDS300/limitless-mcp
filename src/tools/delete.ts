import { z } from 'zod';
import { deleteEntry } from '../db/queries';
import { deleteRelationshipsByEntry } from '../db/relationships';

export const deleteEntrySchema = z.object({
  id: z.string().uuid(),
});

export async function deleteEntryTool(
  env: Env,
  user_id: string,
  provider: string,   // add for API consistency; not used in delete
  input: z.infer<typeof deleteEntrySchema>
): Promise<{ success: boolean; message: string }> {
  // Delete from D1
  const deleted = await deleteEntry(env.DB, input.id, user_id);

  if (!deleted) {
    return {
      success: false,
      message: `No entry found with id ${input.id} for this user`,
    };
  }

  // Remove associated relationships from D1
  await deleteRelationshipsByEntry(env.DB, input.id);

  // Remove vector from Vectorize
  try {
    await env.VECTORIZE.deleteByIds([input.id]);
  } catch (err) {
    throw new Error(`Entry ${input.id} deleted from D1 but vector removal failed: ${String(err)}`);
  }

  return {
    success: true,
    message: `Entry ${input.id} deleted`,
  };
}
