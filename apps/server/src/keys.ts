import type { Store } from '@jev-mod/db/index.ts';
import type { KeyStatus } from '@jev-mod/core/types.ts';

export type KeyEnv = { KEY_ENCRYPTION_SECRET?: string; TYPESAFE_API_KEY?: string };
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));
async function encryptionKey(secret?: string) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw Object.assign(new Error('API key storage is not configured by the operator.'), { status: 409 });
  }
  const bytes = Uint8Array.from(secret.match(/../g)!, byte => parseInt(byte, 16));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptKey(guildId: string, value: string, secret?: string) {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(guildId) }, key, encoder.encode(value));
  return `1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function decryptKey(guildId: string, value: string, secret?: string) {
  const key = await encryptionKey(secret);
  try {
    const [version, iv, ciphertext, extra] = value.split('.');
    if (version !== '1' || !iv || !ciphertext || extra !== undefined) throw new Error();
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(guildId) }, key, decode(ciphertext));
    return new TextDecoder().decode(plaintext);
  } catch { throw new Error('KEY_DECRYPTION_FAILED'); }
}
export async function getKeyStatus(store: Store, guildId: string, env: KeyEnv): Promise<KeyStatus> {
  return { source: await store.hasTypeSafeKey(guildId) ? 'server' : env.TYPESAFE_API_KEY?.trim() ? 'operator' : 'missing' };
}
export async function selectKey(store: Store, guildId: string, env: KeyEnv) {
  const ciphertext = await store.getTypeSafeKey(guildId);
  const key = ciphertext === undefined ? env.TYPESAFE_API_KEY?.trim() : await decryptKey(guildId, ciphertext, env.KEY_ENCRYPTION_SECRET);
  if (!key) throw Object.assign(new Error('Add a TypeSafe API key in Server settings.'), { status: 409 });
  return key;
}
