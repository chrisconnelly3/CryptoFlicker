import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/cache";
import { binanceFetch } from "@/lib/binance";
import type { Ticker } from "@/lib/types";

const TICKERS_PATH = "/api/v3/ticker/24hr";
const CACHE_KEY = "tickers:all";
const CACHE_TTL_MS = 30_000;

const LEVERAGED_RE = /UP$|DOWN$|BULL$|BEAR$/;
const KNOWN_QUOTES = ["USDT", "BUSD", "BTC", "ETH", "BNB", "USDC", "TUSD", "FDUSD"];

function extractQuote(symbol: string): { base: string; quote: string } {
  for (const q of KNOWN_QUOTES) {
    if (symbol.endsWith(q)) {
      return { base: symbol.slice(0, -q.length), quote: q };
    }
  }
  return { base: symbol, quote: "" };
}

async function fetchAll(): Promise<Ticker[]> {
  const cached = cacheGet<Ticker[]>(CACHE_KEY);
  if (cached) return cached;

  const res = await binanceFetch(TICKERS_PATH);
  if (!res.ok) throw new Error(`Binance ${res.status}`);

  const raw: Array<Record<string, string>> = await res.json();

  const tickers: Ticker[] = raw.map((t) => {
    const { base, quote } = extractQuote(t.symbol);
    return {
      symbol: t.symbol,
      baseAsset: base,
      quoteAsset: quote,
      lastPrice: parseFloat(t.lastPrice),
      priceChangePercent: parseFloat(t.priceChangePercent),
      highPrice: parseFloat(t.highPrice),
      lowPrice: parseFloat(t.lowPrice),
      quoteVolume: parseFloat(t.quoteVolume),
      count: parseInt(t.count, 10),
    };
  });

  cacheSet(CACHE_KEY, tickers, CACHE_TTL_MS);
  return tickers;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const quoteAsset = searchParams.get("quoteAsset") ?? "USDT";
    const minQuoteVolume = parseFloat(searchParams.get("minQuoteVolume") ?? "0");
    const minPrice = parseFloat(searchParams.get("minPrice") ?? "0");
    const minChangePct = parseFloat(searchParams.get("minChangePct") ?? "-Infinity");
    const excludeLeveraged = searchParams.get("excludeLeveraged") !== "false";
    const sortBy = searchParams.get("sortBy") ?? "quoteVolume";
    const sortDir = searchParams.get("sortDir") ?? "desc";

    let tickers = await fetchAll();

    tickers = tickers.filter((t) => {
      if (t.quoteAsset !== quoteAsset) return false;
      if (t.quoteVolume < minQuoteVolume) return false;
      if (t.lastPrice < minPrice) return false;
      if (t.priceChangePercent < minChangePct) return false;
      if (excludeLeveraged && LEVERAGED_RE.test(t.baseAsset)) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    tickers.sort((a, b) => {
      const key = sortBy as keyof Ticker;
      const av = a[key] as number;
      const bv = b[key] as number;
      return (av - bv) * dir;
    });

    return NextResponse.json(tickers, {
      headers: {
        "Cache-Control": "s-maxage=30, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("[tickers]", err);
    return NextResponse.json({ error: "Failed to fetch tickers" }, { status: 502 });
  }
}
