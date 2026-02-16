"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import CandleChart from "@/components/CandleChart";
import { useFavorites } from "@/hooks/useFavorites";
import { formatPrice, formatVolume, formatPct } from "@/lib/format";
import type { Ticker, CandleData } from "@/lib/types";

type View = "all" | "favorites";
type SortField = "quoteVolume" | "priceChangePercent" | "lastPrice" | "count";

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function ScreenerPage() {
  /* ── Filters ── */
  const [quoteAsset, setQuoteAsset] = useState("USDT");
  const [minVolumeRaw, setMinVolumeRaw] = useState("");
  const [minChangePctRaw, setMinChangePctRaw] = useState("");
  const [excludeLeveraged, setExcludeLeveraged] = useState(true);
  const [sortBy, setSortBy] = useState<SortField>("quoteVolume");

  const minVolume = useDebounced(minVolumeRaw, 400);
  const minChangePct = useDebounced(minChangePctRaw, 400);

  /* ── Data ── */
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [tickersLoading, setTickersLoading] = useState(true);
  const [tickersError, setTickersError] = useState("");

  /* ── Navigation ── */
  const [view, setView] = useState<View>("all");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentCandles, setCurrentCandles] = useState<CandleData[]>([]);
  const [candlesLoading, setCandlesLoading] = useState(false);

  /* ── Favorites ── */
  const {
    favorites,
    toggle: toggleFav,
    isFavorite,
    exportFavorites,
    importFavorites,
  } = useFavorites();
  const [showFavMenu, setShowFavMenu] = useState(false);

  /* ── Refs ── */
  const candleCacheRef = useRef(new Map<string, CandleData[]>());
  const abortRef = useRef<AbortController | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const favMenuRef = useRef<HTMLDivElement>(null);

  /* ── Read URL params on mount ── */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has("q")) setQuoteAsset(p.get("q")!);
    if (p.has("minVol")) setMinVolumeRaw(p.get("minVol")!);
    if (p.has("minPct")) setMinChangePctRaw(p.get("minPct")!);
    if (p.has("sort")) setSortBy(p.get("sort") as SortField);
    if (p.has("exlev")) setExcludeLeveraged(p.get("exlev") !== "0");
    if (p.has("view")) setView(p.get("view") as View);
  }, []);

  /* ── Persist filters to URL ── */
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const params = new URLSearchParams();
    if (quoteAsset !== "USDT") params.set("q", quoteAsset);
    if (minVolumeRaw) params.set("minVol", minVolumeRaw);
    if (minChangePctRaw) params.set("minPct", minChangePctRaw);
    if (sortBy !== "quoteVolume") params.set("sort", sortBy);
    if (!excludeLeveraged) params.set("exlev", "0");
    if (view !== "all") params.set("view", view);

    const qs = params.toString();
    const url = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [quoteAsset, minVolumeRaw, minChangePctRaw, sortBy, excludeLeveraged, view]);

  /* ── Close favorites menu on outside click ── */
  useEffect(() => {
    if (!showFavMenu) return;
    function onClick(e: MouseEvent) {
      if (
        favMenuRef.current &&
        !favMenuRef.current.contains(e.target as Node)
      ) {
        setShowFavMenu(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showFavMenu]);

  /* ── Derived ── */
  const activeList = useMemo(() => {
    if (view === "favorites") {
      return tickers.filter((t) => favorites.has(t.symbol));
    }
    return tickers;
  }, [tickers, view, favorites]);

  const currentTicker = activeList[currentIndex] ?? null;

  /* ── Clamp index when list shrinks ── */
  useEffect(() => {
    if (activeList.length > 0 && currentIndex >= activeList.length) {
      setCurrentIndex(Math.max(0, activeList.length - 1));
    }
  }, [activeList.length, currentIndex]);

  /* ── Fetch tickers ── */
  useEffect(() => {
    const controller = new AbortController();
    setTickersLoading(true);
    setTickersError("");

    const params = new URLSearchParams({
      quoteAsset,
      sortBy,
      sortDir: "desc",
      excludeLeveraged: excludeLeveraged ? "true" : "false",
    });
    if (minVolume) params.set("minQuoteVolume", minVolume);
    if (minChangePct) params.set("minChangePct", minChangePct);

    fetch(`/api/market/tickers?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Ticker[]) => {
        setTickers(data);
        setCurrentIndex(0);
        setTickersLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.error(err);
        setTickersError(
          "Failed to load tickers. Check your network and try again."
        );
        setTickersLoading(false);
      });

    return () => controller.abort();
  }, [quoteAsset, minVolume, minChangePct, excludeLeveraged, sortBy]);

  /* ── Fetch candles + prefetch ── */
  const fetchCandles = useCallback(
    async (symbol: string, signal?: AbortSignal): Promise<CandleData[]> => {
      const cached = candleCacheRef.current.get(symbol);
      if (cached) return cached;

      const res = await fetch(`/api/market/candles?symbol=${symbol}`, {
        signal,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data: CandleData[] = await res.json();
      candleCacheRef.current.set(symbol, data);
      return data;
    },
    []
  );

  useEffect(() => {
    if (!activeList.length || !currentTicker) {
      setCurrentCandles([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const sym = currentTicker.symbol;

    // Instant flip if cached
    const cached = candleCacheRef.current.get(sym);
    if (cached) {
      setCurrentCandles(cached);
      setCandlesLoading(false);
    } else {
      setCandlesLoading(true);
    }

    // Fetch current
    fetchCandles(sym, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setCurrentCandles(data);
          setCandlesLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setCandlesLoading(false);
      });

    // Prefetch next 5
    for (let i = 1; i <= 5; i++) {
      const idx = currentIndex + i;
      if (idx < activeList.length) {
        fetchCandles(activeList[idx].symbol, controller.signal).catch(
          () => {}
        );
      }
    }
    // Prefetch prev 2
    for (let i = 1; i <= 2; i++) {
      const idx = currentIndex - i;
      if (idx >= 0) {
        fetchCandles(activeList[idx].symbol, controller.signal).catch(
          () => {}
        );
      }
    }
  }, [currentIndex, activeList, currentTicker, fetchCandles]);

  /* ── Navigation callbacks ── */
  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, activeList.length - 1));
  }, [activeList.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  const handleStar = useCallback(() => {
    if (currentTicker) toggleFav(currentTicker.symbol);
  }, [currentTicker, toggleFav]);

  /* ── Keyboard ── */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      switch (e.key) {
        case "ArrowRight":
        case "l":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
        case "h":
          e.preventDefault();
          goPrev();
          break;
        case "s":
          e.preventDefault();
          handleStar();
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev, handleStar]);

  /* ── Reset index on view switch ── */
  useEffect(() => {
    setCurrentIndex(0);
  }, [view]);

  /* ── Favorites import handler ── */
  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          importFavorites(reader.result);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
      setShowFavMenu(false);
    },
    [importFavorites]
  );

  const handleExport = useCallback(() => {
    const json = exportFavorites();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cryptoflicker-favorites.json";
    a.click();
    URL.revokeObjectURL(url);
    setShowFavMenu(false);
  }, [exportFavorites]);

  /* ── Render: loading / error ── */
  if (tickersLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <span className="text-sm text-[#555] animate-pulse">
          Loading tickers...
        </span>
      </div>
    );
  }

  if (tickersError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <span className="text-sm text-red-400">{tickersError}</span>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-1.5 text-xs bg-[#1a1a1a] border border-[#333] rounded hover:bg-[#222] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const pctColor = currentTicker
    ? currentTicker.priceChangePercent >= 0
      ? "text-green-400"
      : "text-red-400"
    : "";
  const starred = currentTicker ? isFavorite(currentTicker.symbol) : false;

  return (
    <div className="flex flex-col h-screen overflow-hidden select-none">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a1a1a] shrink-0">
        <button
          onClick={goPrev}
          disabled={currentIndex === 0}
          className="px-2 py-0.5 text-sm text-[#666] hover:text-white disabled:opacity-20 transition-colors"
          title="Previous (← or h)"
        >
          ◀
        </button>

        {currentTicker ? (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="text-base font-bold text-white tracking-wide">
              {currentTicker.symbol}
            </span>
            <span className="text-sm text-[#aaa] tabular-nums">
              {formatPrice(currentTicker.lastPrice)}
            </span>
            <span className={`text-sm font-semibold tabular-nums ${pctColor}`}>
              {formatPct(currentTicker.priceChangePercent)}
            </span>
            <span className="text-xs text-[#555] tabular-nums">
              Vol {formatVolume(currentTicker.quoteVolume)}
            </span>
          </div>
        ) : (
          <div className="flex-1 text-sm text-[#444]">No symbol selected</div>
        )}

        {/* Star */}
        <button
          onClick={handleStar}
          className={`text-lg leading-none transition-colors ${
            starred ? "text-yellow-400" : "text-[#333] hover:text-[#666]"
          }`}
          title="Star (s)"
        >
          {starred ? "★" : "☆"}
        </button>

        {/* Position */}
        <span className="text-xs text-[#444] tabular-nums w-16 text-right shrink-0">
          {activeList.length > 0
            ? `${currentIndex + 1}/${activeList.length}`
            : "0/0"}
        </span>

        <button
          onClick={goNext}
          disabled={currentIndex >= activeList.length - 1}
          className="px-2 py-0.5 text-sm text-[#666] hover:text-white disabled:opacity-20 transition-colors"
          title="Next (→ or l)"
        >
          ▶
        </button>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-[#1a1a1a] shrink-0 text-[11px] flex-wrap">
        {/* View toggle */}
        <div className="flex rounded overflow-hidden border border-[#222]">
          <button
            onClick={() => setView("all")}
            className={`px-2.5 py-0.5 transition-colors ${
              view === "all"
                ? "bg-[#222] text-white"
                : "bg-[#0e0e0e] text-[#555] hover:text-[#888]"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setView("favorites")}
            className={`px-2.5 py-0.5 transition-colors ${
              view === "favorites"
                ? "bg-[#222] text-yellow-400"
                : "bg-[#0e0e0e] text-[#555] hover:text-[#888]"
            }`}
          >
            ★ {favorites.size}
          </button>
        </div>

        <span className="text-[#222]">│</span>

        {/* Quote asset */}
        <label className="flex items-center gap-1 text-[#555]">
          Quote
          <select
            value={quoteAsset}
            onChange={(e) => setQuoteAsset(e.target.value)}
            className="bg-[#111] border border-[#222] rounded px-1.5 py-0.5 text-[11px] text-[#ccc] focus:border-blue-500 outline-none"
          >
            <option value="USDT">USDT</option>
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
            <option value="BNB">BNB</option>
            <option value="FDUSD">FDUSD</option>
          </select>
        </label>

        {/* Min volume */}
        <label className="flex items-center gap-1 text-[#555]">
          Vol≥
          <input
            type="number"
            value={minVolumeRaw}
            onChange={(e) => setMinVolumeRaw(e.target.value)}
            placeholder="0"
            className="w-24 bg-[#111] border border-[#222] rounded px-1.5 py-0.5 text-[11px] text-[#ccc] focus:border-blue-500 outline-none tabular-nums"
          />
        </label>

        {/* Min change % */}
        <label className="flex items-center gap-1 text-[#555]">
          Δ%≥
          <input
            type="number"
            value={minChangePctRaw}
            onChange={(e) => setMinChangePctRaw(e.target.value)}
            placeholder="-∞"
            className="w-16 bg-[#111] border border-[#222] rounded px-1.5 py-0.5 text-[11px] text-[#ccc] focus:border-blue-500 outline-none tabular-nums"
          />
        </label>

        {/* Sort */}
        <label className="flex items-center gap-1 text-[#555]">
          Sort
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortField)}
            className="bg-[#111] border border-[#222] rounded px-1.5 py-0.5 text-[11px] text-[#ccc] focus:border-blue-500 outline-none"
          >
            <option value="quoteVolume">Volume</option>
            <option value="priceChangePercent">% Change</option>
            <option value="lastPrice">Price</option>
            <option value="count">Trades</option>
          </select>
        </label>

        {/* Exclude leveraged */}
        <label className="flex items-center gap-1.5 text-[#555] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={excludeLeveraged}
            onChange={(e) => setExcludeLeveraged(e.target.checked)}
            className="accent-blue-500"
          />
          Excl. lev.
        </label>

        <span className="text-[#222]">│</span>

        {/* Favorites menu */}
        <div className="relative" ref={favMenuRef}>
          <button
            onClick={() => setShowFavMenu((v) => !v)}
            className="text-[#555] hover:text-[#888] transition-colors px-1"
            title="Favorites menu"
          >
            ⋯
          </button>
          {showFavMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#141414] border border-[#222] rounded shadow-lg z-50 min-w-[140px]">
              <button
                onClick={handleExport}
                className="block w-full text-left px-3 py-1.5 text-[11px] text-[#aaa] hover:bg-[#1a1a1a] hover:text-white transition-colors"
              >
                Export favorites
              </button>
              <button
                onClick={() => importInputRef.current?.click()}
                className="block w-full text-left px-3 py-1.5 text-[11px] text-[#aaa] hover:bg-[#1a1a1a] hover:text-white transition-colors"
              >
                Import favorites
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Chart area ── */}
      <div className="flex-1 min-h-0 relative">
        {activeList.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-[#444]">
              {view === "favorites"
                ? "No favorites yet. Press s to star symbols."
                : "No symbols match your filters."}
            </span>
          </div>
        ) : (
          <>
            {candlesLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/70 z-10">
                <span className="text-xs text-[#555] animate-pulse">
                  Loading chart...
                </span>
              </div>
            )}
            <CandleChart candles={currentCandles} />
          </>
        )}
      </div>

      {/* ── Footer: keyboard hints ── */}
      <div className="flex items-center justify-center gap-5 px-3 py-1 border-t border-[#1a1a1a] shrink-0 text-[10px] text-[#444]">
        <span>
          <Kbd>←</Kbd> <Kbd>→</Kbd> navigate
        </span>
        <span>
          <Kbd>h</Kbd> <Kbd>l</Kbd> vim nav
        </span>
        <span>
          <Kbd>s</Kbd> star
        </span>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1 py-px bg-[#141414] border border-[#222] rounded text-[10px] text-[#555] leading-tight">
      {children}
    </kbd>
  );
}
