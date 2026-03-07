/**
 * crypto.ts
 * Application-level encryption for Limitless content fields.
 *
 * Strategy: Per-user AES-GCM encryption with keys derived from the user's
 * Google OAuth subject ID + a server secret (HKDF). No key storage required —
 * the key is re-derived on every request from the authenticated user's token.
 *
 * What this protects:
 *   - entries.content
 *   - handoffs.content
 *   - Vectorize metadata payloads
 *
 * What stays plaintext (structural, non-sensitive):
 *   - user_id, email, timestamps, status, source, tags, titles
 *
 * Admin guarantee: Opening D1 or Vectorize in the Cloudflare dashboard shows
 * only AES-GCM ciphertext (base64) for all content fields. Unreadable without
 * both the user's OAuth sub AND the SERVER_ENCRYPTION_SECRET.
 */

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96-bit IV, standard for AES-GCM

/**
 * Derives a per-user AES-GCM CryptoKey using HKDF.
 *
 * Key material: HMAC-SHA256(SERVER_ENCRYPTION_SECRET, userSub)
 * This is deterministic — the same user always gets the same key,
 * no key storage required.
 *
 * @param userSub - The user's Google OAuth subject ID (from JWT 'sub' claim)
 * @param serverSecret - From env.SERVER_ENCRYPTION_SECRET (Cloudflare Secret)
 */
export async function deriveUserKey(
  userSub: string,
  serverSecret: string
): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  // Import the server secret as HKDF key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(serverSecret),
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  // Derive a per-user AES-GCM key using the user's sub as salt
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(userSub),
      info: encoder.encode("limitless-content-encryption-v1"),
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false, // not extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a plaintext string using the user's derived key.
 * Returns a base64 string in the format: base64(iv + ciphertext)
 * Safe to store directly in D1 text columns or Vectorize metadata.
 *
 * @param plaintext - The content to encrypt
 * @param key - CryptoKey from deriveUserKey()
 */
export async function encryptContent(
  plaintext: string,
  key: CryptoKey
): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(plaintext)
  );

  // Prepend IV to ciphertext so decrypt can extract it
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a base64-encoded ciphertext string produced by encryptContent().
 * Returns the original plaintext.
 *
 * @param cipherBase64 - base64(iv + ciphertext) from D1 or Vectorize
 * @param key - CryptoKey from deriveUserKey()
 */
export async function decryptContent(
  cipherBase64: string,
  key: CryptoKey
): Promise<string> {
  const combined = Uint8Array.from(atob(cipherBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

/**
 * Convenience wrapper: encrypts a string if it is not already encrypted.
 * Useful for migration — existing plaintext rows can be written back encrypted
 * on next update without a bulk migration script.
 *
 * Detection is naive (checks for base64 pattern) — only use during migration window.
 */
export async function encryptIfPlaintext(
  value: string,
  key: CryptoKey
): Promise<string> {
  // Already looks like our ciphertext format (base64, no spaces)
  const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
  if (base64Pattern.test(value) && value.length > 32) {
    // Could already be encrypted — attempt decrypt to check
    try {
      await decryptContent(value, key);
      return value; // Already encrypted, pass through
    } catch {
      // Decrypt failed — it's plaintext that happens to be base64-ish
    }
  }
  return encryptContent(value, key);
}

/**
 * Decrypts a value, falling back to plaintext if decryption fails.
 * Used during the migration window when existing rows may still be plaintext.
 */
export async function safeDecrypt(value: string, key: CryptoKey): Promise<string> {
  try {
    return await decryptContent(value, key);
  } catch {
    return value; // plaintext fallback during migration window
  }
}
