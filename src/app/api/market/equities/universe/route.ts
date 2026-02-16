import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/cache";
import type { Instrument } from "@/lib/types";

const NASDAQ_LISTED_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
const OTHER_LISTED_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";

const CACHE_KEY = "equities:universe";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Parse the NASDAQ Trader pipe-delimited format.
 * nasdaqlisted.txt columns: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
 * otherlisted.txt columns:  ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
 */
function parseNasdaqListed(text: string): Instrument[] {
  const lines = text.split("\n").filter(Boolean);
  // Skip header row and file-creation footer (last line starts with "File Creation Time")
  const dataLines = lines.slice(1).filter((l) => !l.startsWith("File Creation"));

  return dataLines
    .map((line) => {
      const cols = line.split("|");
      const symbol = (cols[0] ?? "").trim();
      const name = (cols[1] ?? "").trim();
      const isTest = (cols[3] ?? "").trim() === "Y";
      if (!symbol || isTest) return null;
      // Skip symbols with special characters (warrants, units, etc.)
      if (/[^A-Z0-9.]/.test(symbol)) return null;
      return {
        symbol,
        name,
        assetClass: "equity" as const,
        exchange: "NASDAQ",
        lastPrice: 0,
        priceChangePercent: 0,
        volume: 0,
      };
    })
    .filter(Boolean) as Instrument[];
}

function parseOtherListed(text: string): Instrument[] {
  const lines = text.split("\n").filter(Boolean);
  const dataLines = lines.slice(1).filter((l) => !l.startsWith("File Creation"));

  return dataLines
    .map((line) => {
      const cols = line.split("|");
      const symbol = (cols[0] ?? "").trim();
      const name = (cols[1] ?? "").trim();
      const exchange = (cols[2] ?? "").trim();
      const isTest = (cols[6] ?? "").trim() === "Y";
      if (!symbol || isTest) return null;
      if (/[^A-Z0-9.]/.test(symbol)) return null;

      let exchangeLabel = "OTHER";
      if (exchange === "N") exchangeLabel = "NYSE";
      else if (exchange === "A") exchangeLabel = "AMEX";
      else if (exchange === "P") exchangeLabel = "ARCA";
      else if (exchange === "Z") exchangeLabel = "BATS";
      else if (exchange === "V") exchangeLabel = "IEXG";

      return {
        symbol,
        name,
        assetClass: "equity" as const,
        exchange: exchangeLabel,
        lastPrice: 0,
        priceChangePercent: 0,
        volume: 0,
      };
    })
    .filter(Boolean) as Instrument[];
}

async function fetchUniverse(): Promise<Instrument[]> {
  const cached = cacheGet<Instrument[]>(CACHE_KEY);
  if (cached) return cached;

  const [nasdaqRes, otherRes] = await Promise.all([
    fetch(NASDAQ_LISTED_URL),
    fetch(OTHER_LISTED_URL),
  ]);

  if (!nasdaqRes.ok) throw new Error(`NASDAQ listed ${nasdaqRes.status}`);
  if (!otherRes.ok) throw new Error(`Other listed ${otherRes.status}`);

  const nasdaqText = await nasdaqRes.text();
  const otherText = await otherRes.text();

  const nasdaq = parseNasdaqListed(nasdaqText);
  const other = parseOtherListed(otherText);

  // Deduplicate by symbol (prefer NASDAQ entry)
  const seen = new Set<string>();
  const combined: Instrument[] = [];
  for (const inst of [...nasdaq, ...other]) {
    if (!seen.has(inst.symbol)) {
      seen.add(inst.symbol);
      combined.push(inst);
    }
  }

  // Sort alphabetically by symbol
  combined.sort((a, b) => a.symbol.localeCompare(b.symbol));

  cacheSet(CACHE_KEY, combined, CACHE_TTL_MS);
  return combined;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const q = searchParams.get("q")?.toUpperCase().trim();

    let instruments = await fetchUniverse();

    // Optional search filter
    if (q) {
      instruments = instruments.filter(
        (i) => i.symbol.includes(q) || (i.name?.toUpperCase().includes(q) ?? false),
      );
    }

    return NextResponse.json(instruments, {
      headers: {
        "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("[equities/universe]", err);
    return NextResponse.json(
      { error: "Failed to fetch equities universe" },
      { status: 502 },
    );
  }
}
