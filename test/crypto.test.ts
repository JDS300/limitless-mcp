import { describe, it, expect } from 'vitest';
import {
  deriveUserKey,
  encryptContent,
  safeDecrypt,
  signAdminToken,
  verifyAdminToken,
} from '../src/crypto';

describe('deriveUserKey', () => {
  it('derives a CryptoKey', async () => {
    const key = await deriveUserKey('google:user123', 'test-secret-at-least-32-chars!!');
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
  });

  it('same salt produces same encryption (round-trip)', async () => {
    const secret = 'test-secret-at-least-32-chars!!';
    const key1 = await deriveUserKey('google:user123', secret);
    const key2 = await deriveUserKey('google:user123', secret);
    const encrypted = await encryptContent('hello', key1);
    const decrypted = await safeDecrypt(encrypted, key2);
    expect(decrypted).toBe('hello');
  });

  it('different salt cannot decrypt (safeDecrypt returns ciphertext)', async () => {
    const secret = 'test-secret-at-least-32-chars!!';
    const key1 = await deriveUserKey('google:user1', secret);
    const key2 = await deriveUserKey('google:user2', secret);
    const encrypted = await encryptContent('hello', key1);
    const decrypted = await safeDecrypt(encrypted, key2);
    expect(decrypted).not.toBe('hello');
  });
});

describe('admin session tokens', () => {
  const secret = 'test-secret-at-least-32-chars!!';

  it('signs and verifies a valid token', async () => {
    const token = await signAdminToken('user123', secret);
    const userId = await verifyAdminToken(token, secret);
    expect(userId).toBe('user123');
  });

  it('rejects a tampered token', async () => {
    const token = await signAdminToken('user123', secret);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(await verifyAdminToken(tampered, secret)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signAdminToken('user123', secret, -1000);
    expect(await verifyAdminToken(token, secret)).toBeNull();
  });
});
