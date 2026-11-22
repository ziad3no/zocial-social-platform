/** Settings read from the environment. None of them are secrets except the database URL. */
export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production' || !!env.VERCEL
  return {
    production,
    // Supabase/Vercel set POSTGRES_URL; DATABASE_URL works for any other Postgres.
    databaseUrl: env.DATABASE_URL || env.POSTGRES_URL || undefined,
    dataDir: env.DATA_DIR ?? './data',
    demoLogin: (env.DEMO_LOGIN ?? 'true') === 'true',
    // The shared public demo resets daily on Vercel unless told otherwise.
    demoResetHours: Number(env.DEMO_RESET_HOURS ?? (env.VERCEL ? 24 : 0)),
  }
}
