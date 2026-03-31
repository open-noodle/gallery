export function without<T extends Record<string, unknown>>(options: T, ...keys: (keyof T)[]): T {
  const result = { ...options };
  for (const key of keys) {
    result[key] = undefined as T[keyof T];
  }
  return result;
}
