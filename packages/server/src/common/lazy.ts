/**
 * Lazy module loader. Caches the promise so subsequent calls skip the
 * import. Use for slow-to-import modules (LangChain, pnpm-cached paths)
 * that aren't needed on every request.
 */
export function lazy<T>(loader: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => (cached ??= loader());
}
