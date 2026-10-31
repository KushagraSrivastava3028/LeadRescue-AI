import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { encryptionConfig } from './config';

/** AES-256-GCM envelope binds encrypted tokens to the intended business and key version. */
export function encryptToken(plaintext: string, businessId: string): string {
  const { key, version } = encryptionConfig();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${version}:${businessId}`));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    version,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}
export function decryptToken(envelope: string, businessId: string): string {
  const { key, version } = encryptionConfig();
  const [v, iv, tag, encrypted, ...rest] = envelope.split('.');
  if (v !== version || !iv || !tag || !encrypted || rest.length)
    throw new Error('Token key version unavailable');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(`${version}:${businessId}`));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
