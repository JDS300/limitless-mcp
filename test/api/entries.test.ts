import { describe, it, expect, vi } from 'vitest';
import { handleApiRequest } from '../../src/api/entries';
import { signAdminToken } from '../../src/crypto';

const SECRET = 'test-secret-minimum-32-characters!';

async function makeReq(path: string, method = 'GET', body?: object, auth = true) {
  const token = await signAdminToken('user1', SECRET);
  return new Request(`http://test${path}`, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const makeEnv = () => ({
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all:   vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue(null),
        run:   vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      }),
    }),
  },
  VECTORIZE: {
    upsert:      vi.fn().mockResolvedValue({}),
    deleteByIds: vi.fn().mockResolvedValue({}),
  },
  AI: { run: vi.fn().mockResolvedValue({ data: [new Array(768).fill(0.1)] }) },
  SERVER_ENCRYPTION_SECRET: SECRET,
});

describe('handleApiRequest', () => {
  it('returns 401 without token', async () => {
    const res = await handleApiRequest(await makeReq('/api/entries', 'GET', undefined, false), makeEnv() as any);
    expect(res.status).toBe(401);
  });

  it('GET /api/entries returns 200 with results array', async () => {
    const res = await handleApiRequest(await makeReq('/api/entries'), makeEnv() as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.results)).toBe(true);
  });

  it('GET /api/entries?namespace=null applies IS NULL filter', async () => {
    const env = makeEnv() as any;
    await handleApiRequest(await makeReq('/api/entries?namespace=null'), env);
    const sql: string = env.DB.prepare.mock.calls[0][0];
    expect(sql).toContain('IS NULL');
  });

  it('PATCH /api/entries/:id returns 404 when not found', async () => {
    const res = await handleApiRequest(
      await makeReq('/api/entries/some-id', 'PATCH', { namespace: 'work' }),
      makeEnv() as any
    );
    expect(res.status).toBe(404);
  });

  it('DELETE /api/entries/:id returns 200 on success', async () => {
    const res = await handleApiRequest(await makeReq('/api/entries/x', 'DELETE'), makeEnv() as any);
    expect(res.status).toBe(200);
  });

  it('returns 405 for unsupported methods', async () => {
    const res = await handleApiRequest(await makeReq('/api/entries', 'POST'), makeEnv() as any);
    expect(res.status).toBe(405);
  });
});
