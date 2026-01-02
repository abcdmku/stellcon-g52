export function logServerError(label: string, error: unknown, extras: Record<string, unknown> = {}) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[server:${label}] ${message}`, extras);
}
