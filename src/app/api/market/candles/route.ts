import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/cache";
import { binanceFetch } from "@/lib/binance";
import { fetchYahooCandles } from "@/lib/yahoo";
import type { CandleData, AssetClass } from "@/lib/types";

const KLINES_PATH = "/api/v3/klines";
const CRYPTO_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min for crypto daily candles
const EQUITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours for equity daily candles

async function fetchCryptoCandles(
  symbol: string,
  interval: string,
  limit: string,
): Promise<CandleData[]> {
  const path = `${KLINES_PATH}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const res = await binanceFetch(path);
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`);

  const raw: Array<Array<string | number>> = await res.json();

  return raw.map((k) => ({
    time: Math.floor((k[0] as number) / 1000),
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    const interval = searchParams.get("interval") ?? "1d";
    const limit = searchParams.get("limit") ?? "365";
    const assetClass: AssetClass =
      (searchParams.get("assetClass") as AssetClass) ?? "crypto";

    if (!symbol) {
      return NextResponse.json(
        { error: "symbol is required" },
        { status: 400 },
      );
    }

    const cacheKey = `candles:${assetClass}:${symbol}:${interval}:${limit}`;
    const cached = cacheGet<CandleData[]>(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          "Cache-Control": "s-maxage=600, stale-while-revalidate=86400",
          "X-Cache": "HIT",
        },
      });
    }

    let candles: CandleData[];

    if (assetClass === "equity") {
      candles = await fetchYahooCandles(symbol, interval);
      cacheSet(cacheKey, candles, EQUITY_CACHE_TTL_MS);
    } else {
      candles = await fetchCryptoCandles(symbol, interval, limit);
      cacheSet(cacheKey, candles, CRYPTO_CACHE_TTL_MS);
    }

    return NextResponse.json(candles, {
      headers: {
        "Cache-Control": "s-maxage=600, stale-while-revalidate=86400",
        "X-Cache": "MISS",
      },
    });
  } catch (err) {
    console.error("[candles]", err);
    return NextResponse.json(
      { error: "Failed to fetch candles" },
      { status: 502 },
    );
  }
}
