/** One place for the model name so the reader and the course lookup can't drift apart. */
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

/**
 * Optional shared key. The app has no login by design, so this is a speed
 * bump, not a lock: it stops a stray URL from being a free vision endpoint.
 * Set NEXT_PUBLIC_APP_KEY in Vercel; if it's unset nothing is enforced.
 */
export function appKeyOk(req: Request): boolean {
  const key = process.env.NEXT_PUBLIC_APP_KEY;
  if (!key) return true;
  return req.headers.get("x-cox45-key") === key;
}

export function appKeyHeaders(): Record<string, string> {
  const key = process.env.NEXT_PUBLIC_APP_KEY;
  return key ? { "x-cox45-key": key } : {};
}
