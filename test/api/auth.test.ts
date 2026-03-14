import { describe, it, expect } from 'vitest';
import { extractAdminUserId } from '../../src/api/auth';
import { signAdminToken } from '../../src/crypto';

const SECRET = 'test-secret-minimum-32-characters!';

describe('extractAdminUserId', () => {
  it('returns userId for a valid Bearer token', async () => {
    const token = await signAdminToken('user123', SECRET);
    const req = new Request('http://test/api/entries', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await extractAdminUserId(req, SECRET)).toBe('user123');
  });

  it('returns null when Authorization header missing', async () => {
    expect(await extractAdminUserId(new Request('http://test/'), SECRET)).toBeNull();
  });

  it('returns null for invalid token', async () => {
    const req = new Request('http://test/', { headers: { Authorization: 'Bearer bad.sig' } });
    expect(await extractAdminUserId(req, SECRET)).toBeNull();
  });
});
