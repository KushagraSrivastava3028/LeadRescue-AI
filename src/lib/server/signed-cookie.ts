import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { ConfigurationError, getServerEnv } from './env';

function key() {
  const env = getServerEnv();
  if (!env.AUTH_COOKIE_SECRET) throw new ConfigurationError(['AUTH_COOKIE_SECRET']);
  return new TextEncoder().encode(env.AUTH_COOKIE_SECRET);
}
export async function signCookie(
  payload: Record<string, unknown>,
  purpose: string,
  expiresIn = '10m',
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setAudience(purpose)
    .setIssuer('leadrescue')
    .setExpirationTime(expiresIn)
    .sign(key());
}
export async function verifyCookie(token: string, purpose: string) {
  const { payload } = await jwtVerify(token, key(), {
    algorithms: ['HS256'],
    issuer: 'leadrescue',
    audience: purpose,
  });
  return payload;
}
