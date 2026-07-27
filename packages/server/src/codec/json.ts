/**
 * Parse JSON without throwing. On failure, returns `{ __raw }` so the caller
 * can still see the original string instead of losing it on parse error.
 */
export function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { __raw: s };
  }
}
