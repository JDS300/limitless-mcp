import { z } from 'zod';
import { deleteEntry } from '../db/queries';

export const deleteEntrySchema = z.object({
  id: z.string().uuid(),
});

export async function deleteEntryTool(
  env: Env,
  user_id: string,
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

  // Remove vector from Vectorize
  await env.VECTORIZE.deleteByIds([input.id]);

  return {
    success: true,
    message: `Entry ${input.id} deleted`,
  };
}
