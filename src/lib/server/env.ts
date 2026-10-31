import 'server-only';
import { z } from 'zod';

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');
const optionalSecret = z.string().min(1).optional();
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ORIGIN: z.string().url().default('http://127.0.0.1:3000'),
  DEMO_MODE: flag,
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  AUTH_COOKIE_SECRET: z.string().min(32).optional(),
  TRUST_PROXY: flag,
  TRUSTED_CLIENT_IP_HEADER: z.enum(['x-real-ip', 'cf-connecting-ip']).optional(),
});

export type ServerEnv = z.infer<typeof environmentSchema>;

export class ConfigurationError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Configuration unavailable: ${variables.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

/** Reads only the fields needed by the web authentication boundary. Never log values. */
export function getServerEnv(): ServerEnv {
  const result = environmentSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    APP_ORIGIN: process.env.APP_ORIGIN,
    DEMO_MODE: process.env.DEMO_MODE,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    AUTH_COOKIE_SECRET: process.env.AUTH_COOKIE_SECRET,
    TRUST_PROXY: process.env.TRUST_PROXY,
    TRUSTED_CLIENT_IP_HEADER: process.env.TRUSTED_CLIENT_IP_HEADER,
  });
  if (!result.success)
    throw new ConfigurationError(result.error.issues.map((issue) => String(issue.path[0])));
  const env = result.data;
  const origin = new URL(env.APP_ORIGIN);
  const invalid: string[] = [];
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
    invalid.push('APP_ORIGIN');
  if (env.TRUST_PROXY && !env.TRUSTED_CLIENT_IP_HEADER) invalid.push('TRUSTED_CLIENT_IP_HEADER');
  if (env.NODE_ENV === 'production') {
    if (origin.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(origin.hostname))
      invalid.push('APP_ORIGIN');
    if (env.DEMO_MODE) invalid.push('DEMO_MODE');
    for (const name of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'AUTH_COOKIE_SECRET',
    ] as const) {
      const value = env[name];
      if (!value || /placeholder|replace[-_ ]?me|your[-_]|example\.com/i.test(value))
        invalid.push(name);
    }
    if (env.NEXT_PUBLIC_SUPABASE_URL && new URL(env.NEXT_PUBLIC_SUPABASE_URL).protocol !== 'https:')
      invalid.push('NEXT_PUBLIC_SUPABASE_URL');
  }
  if (invalid.length) throw new ConfigurationError([...new Set(invalid)]);
  env.APP_ORIGIN = origin.origin;
  return env;
}

export function requireSupabaseConfiguration() {
  const env = getServerEnv();
  const missing = [
    !env.NEXT_PUBLIC_SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL',
    !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ].filter((name): name is string => Boolean(name));
  if (missing.length) throw new ConfigurationError(missing);
  return {
    env,
    url: env.NEXT_PUBLIC_SUPABASE_URL!,
    key: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  };
}
