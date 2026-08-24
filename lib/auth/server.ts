import { createHash } from 'node:crypto';
import { createNeonAuth } from '@neondatabase/auth/next/server';

const DEFAULT_AUTH_BASE_URL =
  'https://ep-proud-hall-ac88vobb.neonauth.sa-east-1.aws.neon.tech/neondb/auth';

function resolveCookieSecret() {
  if (process.env.NEON_AUTH_COOKIE_SECRET) return process.env.NEON_AUTH_COOKIE_SECRET;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'NEON_AUTH_COOKIE_SECRET is not configured and DATABASE_URL is unavailable for secure fallback derivation',
    );
  }

  return createHash('sha256')
    .update(`anyphoto:neon-auth-cookie:v1:${databaseUrl}`)
    .digest('hex');
}

export function getAuth() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL;
  const secret = resolveCookieSecret();

  return createNeonAuth({
    baseUrl,
    cookies: { secret },
    logLevel: process.env.NODE_ENV === 'development' ? 'warn' : 'error',
  });
}
