const BASES = [
  process.env.BINANCE_BASE_URL,
  "https://api.binance.us",
  "https://api.binance.com",
].filter(Boolean) as string[];

let lastWorkingBase: string | null = null;

/**
 * Fetch from Binance with automatic fallback across endpoints.
 * Remembers the last working base URL to minimize retries.
 */
export async function binanceFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const ordered = lastWorkingBase
    ? [lastWorkingBase, ...BASES.filter((b) => b !== lastWorkingBase)]
    : BASES;

  let lastError: Error | null = null;

  for (const base of ordered) {
    try {
      const res = await fetch(`${base}${path}`, init);
      if (res.status === 451 || res.status === 403) {
        continue;
      }
      lastWorkingBase = base;
      return res;
    } catch (err) {
      lastError = err as Error;
      continue;
    }
  }

  throw lastError ?? new Error("All Binance endpoints unavailable");
}
