import type { CandleData } from "./types";

const YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

/**
 * Map US equity symbols to Yahoo Finance format.
 * Most are identical, but some have dots that Yahoo uses dashes for.
 * Examples: BRK.B -> BRK-B, BF.B -> BF-B
 */
function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-");
}

/**
 * Map our interval values to Yahoo Finance interval params.
 * Yahoo supports: 1d, 5d, 1wk, 1mo, 3mo
 */
function toYahooInterval(interval: string): string {
  switch (interval) {
    case "1w":
      return "1wk";
    case "4h":
      // Yahoo doesn't support 4h for long ranges; use 1d as fallback
      return "1d";
    default:
      return interval;
  }
}

/**
 * Map our interval to Yahoo Finance range param.
 * This determines how far back in history to fetch.
 */
function toYahooRange(interval: string): string {
  switch (interval) {
    case "4h":
    case "1d":
      return "1y";
    case "1w":
      return "5y";
    default:
      return "1y";
  }
}

export async function fetchYahooCandles(
  symbol: string,
  interval: string,
  signal?: AbortSignal,
): Promise<CandleData[]> {
  const ySymbol = toYahooSymbol(symbol);
  const yInterval = toYahooInterval(interval);
  const yRange = toYahooRange(interval);

  const url = `${YF_BASE}/${encodeURIComponent(ySymbol)}?interval=${yInterval}&range=${yRange}&includePrePost=false`;

  const res = await fetch(url, {
    signal,
    headers: {
      "User-Agent": "CryptoFlicker/1.0",
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance ${res.status}: ${symbol}`);
  }

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) {
    throw new Error(`No chart data for ${symbol}`);
  }

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];

  if (!quote || !timestamps.length) {
    return [];
  }

  const opens: (number | null)[] = quote.open ?? [];
  const highs: (number | null)[] = quote.high ?? [];
  const lows: (number | null)[] = quote.low ?? [];
  const closes: (number | null)[] = quote.close ?? [];
  const volumes: (number | null)[] = quote.volume ?? [];

  const candles: CandleData[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const v = volumes[i];
    // Skip bars with null values (e.g. holidays)
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({
      time: timestamps[i],
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v ?? 0,
    });
  }

  return candles;
}
