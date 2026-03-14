import { verifyAdminToken } from '../crypto';

/**
 * Extracts and verifies the admin Bearer token from a request.
 * Returns userId if valid, or null if missing/invalid/expired.
 */
export async function extractAdminUserId(
  request: Request,
  serverSecret: string
): Promise<string | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return verifyAdminToken(auth.slice(7), serverSecret);
}
