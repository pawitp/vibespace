export function mustEnv(env, key) {
  const val = env[key];
  if (!val) {
    throw new Error(`Missing env var: ${key}`);
  }
  return String(val);
}
