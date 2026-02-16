"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import CandleChart from "@/components/CandleChart";
import { useFavorites } from "@/hooks/useFavorites";
import { formatPrice, formatVolume, formatPct } from "@/lib/format";
import type { Ticker, CandleData } from "@/lib/types";

type View = "all" | "favorites";
type SortField = "quoteVolume" | "priceChangePercent" | "lastPrice" | "count";
type CacheStatus = "idle" | "cached" | "fetching" | "error";

const TIMEFRAMES = [
  { value: "1d", label: "1D", tooltip: "Each candlestick = 1 day" },
  { value: "4h", label: "4H", tooltip: "Each candlestick = 4 hours" },
  { value: "1w", label: "1W", tooltip: "Each candlestick = 1 week" },
] as const;

const SESSION_KEY = "cryptoflicker:session";
const SKIP_KEY = "cryptoflicker:skipped";

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function loadSession(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function saveSession(data: Record<string, string>) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function loadSkipped(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SKIP_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // ignore
  }
  return new Set();
}

function saveSkipped(set: Set<string>) {
  try {
    sessionStorage.setItem(SKIP_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
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

  /* ── Timeframe ── */
  const [interval, setInterval_] = useState("1d");
  const tfObj = TIMEFRAMES.find((t) => t.value === interval) ?? TIMEFRAMES[0];

  /* ── Data ── */
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [tickersLoading, setTickersLoading] = useState(true);
  const [tickersError, setTickersError] = useState("");

  /* ── Navigation ── */
  const [view, setView] = useState<View>("all");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentCandles, setCurrentCandles] = useState<CandleData[]>([]);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>("idle");

  /* ── SMA toggle ── */
  const [showSMA, setShowSMA] = useState(false);

  /* ── Search ── */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  /* ── Skip tagging ── */
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  /* ── Favorites ── */
  const {
    favorites,
    toggle: toggleFav,
    isFavorite,
    getNote,
    setNote,
    exportFavorites,
    importFavorites,
  } = useFavorites();
  const [showFavMenu, setShowFavMenu] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState("");
  const noteInputRef = useRef<HTMLInputElement>(null);

  /* ── Prefetch depth ── */
  const [prefetchDepth, setPrefetchDepth] = useState(5);

  /* ── Settings panel ── */
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  /* ── Refs ── */
  const candleCacheRef = useRef(new Map<string, CandleData[]>());
  const abortRef = useRef<AbortController | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const favMenuRef = useRef<HTMLDivElement>(null);
  const sessionLoaded = useRef(false);

  /* ── Load session + skipped on mount ── */
  useEffect(() => {
    const s = loadSession();
    const p = new URLSearchParams(window.location.search);

    // URL params take priority, then session
    setQuoteAsset(p.get("q") ?? s.quoteAsset ?? "USDT");
    setMinVolumeRaw(p.get("minVol") ?? s.minVolumeRaw ?? "");
    setMinChangePctRaw(p.get("minPct") ?? s.minChangePctRaw ?? "");
    setSortBy((p.get("sort") ?? s.sortBy ?? "quoteVolume") as SortField);
    setExcludeLeveraged(
      p.has("exlev") ? p.get("exlev") !== "0" : s.excludeLeveraged !== "false"
    );
    setView((p.get("view") ?? s.view ?? "all") as View);
    setInterval_(p.get("tf") ?? s.interval ?? "1d");
    if (s.showSMA === "true") setShowSMA(true);
    if (s.prefetchDepth) setPrefetchDepth(parseInt(s.prefetchDepth, 10) || 5);

    // Restore index after tickers load (stored in ref for later)
    if (s.currentIndex) {
      sessionLoaded.current = false;
      // Will be applied after tickers load
    }

    setSkipped(loadSkipped());
  }, []);

  /* ── Persist session ── */
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // URL
    const params = new URLSearchParams();
    if (quoteAsset !== "USDT") params.set("q", quoteAsset);
    if (minVolumeRaw) params.set("minVol", minVolumeRaw);
    if (minChangePctRaw) params.set("minPct", minChangePctRaw);
    if (sortBy !== "quoteVolume") params.set("sort", sortBy);
    if (!excludeLeveraged) params.set("exlev", "0");
    if (view !== "all") params.set("view", view);
    if (interval !== "1d") params.set("tf", interval);

    const qs = params.toString();
    const url = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    window.history.replaceState(null, "", url);

    // Session storage
    saveSession({
      quoteAsset,
      minVolumeRaw,
      minChangePctRaw,
      sortBy,
      excludeLeveraged: String(excludeLeveraged),
      view,
      interval,
      currentIndex: String(currentIndex),
      showSMA: String(showSMA),
      prefetchDepth: String(prefetchDepth),
    });
  }, [
    quoteAsset,
    minVolumeRaw,
    minChangePctRaw,
    sortBy,
    excludeLeveraged,
    view,
    interval,
    currentIndex,
    showSMA,
    prefetchDepth,
  ]);

  /* ── Close menus on outside click ── */
  useEffect(() => {
    if (!showFavMenu && !showSettings) return;
    function onClick(e: MouseEvent) {
      if (
        showFavMenu &&
        favMenuRef.current &&
        !favMenuRef.current.contains(e.target as Node)
      ) {
        setShowFavMenu(false);
      }
      if (
        showSettings &&
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        setShowSettings(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showFavMenu, showSettings]);

  /* ── Derived ── */
  const activeList = useMemo(() => {
    let list = tickers;
    if (view === "favorites") {
      list = list.filter((t) => favorites.has(t.symbol));
    }
    return list;
  }, [tickers, view, favorites]);

  const currentTicker = activeList[currentIndex] ?? null;
  const isSkipped = currentTicker ? skipped.has(currentTicker.symbol) : false;

  /* ── Clamp index ── */
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

        // Restore session index if we haven't yet
        if (!sessionLoaded.current) {
          const s = loadSession();
          const savedIdx = parseInt(s.currentIndex ?? "0", 10);
          if (savedIdx >= 0 && savedIdx < data.length) {
            setCurrentIndex(savedIdx);
          } else {
            setCurrentIndex(0);
          }
          sessionLoaded.current = true;
        } else {
          setCurrentIndex(0);
        }

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

  /* ── Clear candle cache when timeframe changes ── */
  useEffect(() => {
    candleCacheRef.current.clear();
  }, [interval]);

  /* ── Fetch candles + prefetch ── */
  const fetchCandles = useCallback(
    async (symbol: string, signal?: AbortSignal): Promise<CandleData[]> => {
      const cacheKey = `${symbol}:${interval}`;
      const cached = candleCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const res = await fetch(
        `/api/market/candles?symbol=${symbol}&interval=${interval}`,
        { signal }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data: CandleData[] = await res.json();
      candleCacheRef.current.set(cacheKey, data);
      return data;
    },
    [interval]
  );

  useEffect(() => {
    if (!activeList.length || !currentTicker) {
      setCurrentCandles([]);
      setCacheStatus("idle");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const sym = currentTicker.symbol;
    const cacheKey = `${sym}:${interval}`;

    // Instant flip if cached
    const cached = candleCacheRef.current.get(cacheKey);
    if (cached) {
      setCurrentCandles(cached);
      setCandlesLoading(false);
      setCacheStatus("cached");
    } else {
      setCandlesLoading(true);
      setCacheStatus("fetching");
    }

    fetchCandles(sym, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setCurrentCandles(data);
          setCandlesLoading(false);
          setCacheStatus("cached");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCandlesLoading(false);
          setCacheStatus("error");
        }
      });

    // Prefetch ahead
    for (let i = 1; i <= prefetchDepth; i++) {
      const idx = currentIndex + i;
      if (idx < activeList.length) {
        fetchCandles(activeList[idx].symbol, controller.signal).catch(
          () => {}
        );
      }
    }
    // Prefetch behind
    for (let i = 1; i <= 2; i++) {
      const idx = currentIndex - i;
      if (idx >= 0) {
        fetchCandles(activeList[idx].symbol, controller.signal).catch(
          () => {}
        );
      }
    }
  }, [currentIndex, activeList, currentTicker, fetchCandles, interval, prefetchDepth]);

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

  const handleSkip = useCallback(() => {
    if (!currentTicker) return;
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(currentTicker.symbol)) {
        next.delete(currentTicker.symbol);
      } else {
        next.add(currentTicker.symbol);
      }
      saveSkipped(next);
      return next;
    });
  }, [currentTicker]);

  const handleToggleSMA = useCallback(() => {
    setShowSMA((v) => !v);
  }, []);

  const cycleTimeframe = useCallback(() => {
    setInterval_((cur) => {
      const idx = TIMEFRAMES.findIndex((t) => t.value === cur);
      return TIMEFRAMES[(idx + 1) % TIMEFRAMES.length].value;
    });
  }, []);

  /* ── Search ── */
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchQuery("");
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, []);

  const handleSearchSubmit = useCallback(() => {
    const q = searchQuery.toUpperCase().trim();
    if (!q) {
      closeSearch();
      return;
    }
    const idx = activeList.findIndex((t) =>
      t.symbol.includes(q)
    );
    if (idx >= 0) {
      setCurrentIndex(idx);
    }
    closeSearch();
  }, [searchQuery, activeList, closeSearch]);

  /* ── Note editing ── */
  const startEditNote = useCallback(() => {
    if (!currentTicker) return;
    setNoteValue(getNote(currentTicker.symbol));
    setEditingNote(true);
    setTimeout(() => noteInputRef.current?.focus(), 0);
  }, [currentTicker, getNote]);

  const saveNote = useCallback(() => {
    if (currentTicker) {
      setNote(currentTicker.symbol, noteValue);
    }
    setEditingNote(false);
  }, [currentTicker, noteValue, setNote]);

  /* ── Keyboard ── */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Let search input and note input handle their own keys
      if (searchOpen || editingNote) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (searchOpen) closeSearch();
          if (editingNote) setEditingNote(false);
        }
        if (e.key === "Enter" && searchOpen) {
          e.preventDefault();
          handleSearchSubmit();
        }
        if (e.key === "Enter" && editingNote) {
          e.preventDefault();
          saveNote();
        }
        return;
      }

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
        case "x":
          e.preventDefault();
          handleSkip();
          break;
        case "m":
          e.preventDefault();
          handleToggleSMA();
          break;
        case "t":
          e.preventDefault();
          cycleTimeframe();
          break;
        case "/":
          e.preventDefault();
          openSearch();
          break;
        case "n":
          e.preventDefault();
          startEditNote();
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    goNext,
    goPrev,
    handleStar,
    handleSkip,
    handleToggleSMA,
    cycleTimeframe,
    openSearch,
    closeSearch,
    searchOpen,
    editingNote,
    handleSearchSubmit,
    saveNote,
    startEditNote,
  ]);

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
  const currentNote = currentTicker ? getNote(currentTicker.symbol) : "";
  const statusColor =
    cacheStatus === "cached"
      ? "bg-green-500"
      : cacheStatus === "fetching"
        ? "bg-amber-500 animate-pulse"
        : cacheStatus === "error"
          ? "bg-red-500"
          : "bg-[#333]";

  return (
    <div className="flex flex-col h-screen overflow-hidden select-none">
      {/* ── Search overlay ── */}
      {searchOpen && (
        <div className="absolute inset-x-0 top-0 z-50 flex justify-center pt-16">
          <div className="bg-[#141414] border border-[#333] rounded-lg shadow-2xl px-4 py-3 w-80">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search symbol... (Enter to jump, Esc to close)"
              className="w-full bg-transparent border-b border-[#333] pb-2 text-sm text-white placeholder:text-[#555] outline-none"
              autoComplete="off"
            />
            {searchQuery && (
              <div className="mt-2 max-h-40 overflow-y-auto text-[11px]">
                {activeList
                  .map((t, i) => ({ t, i }))
                  .filter(({ t }) =>
                    t.symbol.toUpperCase().includes(searchQuery.toUpperCase())
                  )
                  .slice(0, 10)
                  .map(({ t, i }) => (
                    <button
                      key={t.symbol}
                      onClick={() => {
                        setCurrentIndex(i);
                        closeSearch();
                      }}
                      className="block w-full text-left px-2 py-1 hover:bg-[#1a1a1a] text-[#aaa] rounded transition-colors"
                    >
                      <span className="text-white">{t.symbol}</span>{" "}
                      <span className="text-[#555]">
                        {formatPrice(t.lastPrice)}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          UNIFIED TOOLBAR - single row, grouped by purpose
          [NAV] [TICKER] [LIST] [TF] [FILTERS] [OVERLAYS] [ACTIONS] [TOOLS]
          ══════════════════════════════════════════════════ */}
      <div className="flex items-center gap-0 px-1 py-1 border-b border-[#1a1a1a] shrink-0 text-[11px]">

        {/* ── GROUP: Navigation ── */}
        <div className="flex items-center shrink-0">
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="px-1.5 py-0.5 text-[11px] text-[#555] hover:text-white disabled:opacity-20 transition-colors"
            title="Previous (← or h)"
          >
            ◀
          </button>
          <span className="text-[10px] text-[#444] tabular-nums w-14 text-center">
            {activeList.length > 0
              ? `${currentIndex + 1}/${activeList.length}`
              : "0/0"}
          </span>
          <button
            onClick={goNext}
            disabled={currentIndex >= activeList.length - 1}
            className="px-1.5 py-0.5 text-[11px] text-[#555] hover:text-white disabled:opacity-20 transition-colors"
            title="Next (→ or l)"
          >
            ▶
          </button>
        </div>

        <Sep />

        {/* ── GROUP: Ticker context ── */}
        {currentTicker ? (
          <div className="flex items-center gap-2 min-w-0 shrink">
            <span
              className={`text-[12px] font-bold tracking-wide leading-none ${
                isSkipped ? "text-[#444] line-through" : "text-white"
              }`}
            >
              {currentTicker.symbol}
            </span>
            <span className="text-[11px] text-[#999] tabular-nums leading-none">
              {formatPrice(currentTicker.lastPrice)}
            </span>
            <span
              className={`text-[11px] font-semibold tabular-nums leading-none ${pctColor}`}
            >
              {formatPct(currentTicker.priceChangePercent)}
            </span>
            <span className="text-[10px] text-[#555] tabular-nums leading-none">
              {formatVolume(currentTicker.quoteVolume)}
            </span>
            {/* Note inline (truncated) */}
            {currentNote && !editingNote && (
              <button
                onClick={startEditNote}
                className="text-[10px] text-[#555] hover:text-[#888] truncate max-w-28 leading-none transition-colors"
                title={`Note: ${currentNote} (n to edit)`}
              >
                &ldquo;{currentNote}&rdquo;
              </button>
            )}
            {/* Cache status dot */}
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`}
              title={`${cacheStatus}`}
            />
          </div>
        ) : (
          <span className="text-[11px] text-[#444] px-1">No symbol</span>
        )}

        <Sep />

        {/* ── GROUP: List view ── */}
        <div className="flex rounded overflow-hidden border border-[#1e1e1e] shrink-0">
          <button
            onClick={() => setView("all")}
            className={`px-2 py-px text-[10px] transition-colors ${
              view === "all"
                ? "bg-[#1e1e1e] text-[#ccc]"
                : "text-[#555] hover:text-[#888]"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setView("favorites")}
            className={`px-2 py-px text-[10px] transition-colors ${
              view === "favorites"
                ? "bg-[#1e1e1e] text-yellow-400"
                : "text-[#555] hover:text-[#888]"
            }`}
          >
            ★{favorites.size}
          </button>
        </div>

        {/* ── GROUP: Timeframe ── */}
        <div className="flex rounded overflow-hidden border border-[#1e1e1e] ml-1.5 shrink-0">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setInterval_(tf.value)}
              className={`px-1.5 py-px text-[10px] transition-colors ${
                interval === tf.value
                  ? "bg-[#1e1e1e] text-blue-400"
                  : "text-[#555] hover:text-[#888]"
              }`}
              title={tf.tooltip}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <Sep />

        {/* ── GROUP: Filters ── */}
        <div className="flex items-center gap-1.5 shrink-0">
          <select
            value={quoteAsset}
            onChange={(e) => setQuoteAsset(e.target.value)}
            className="bg-[#111] border border-[#1e1e1e] rounded px-1 py-px text-[10px] text-[#999] focus:border-blue-500/50 outline-none"
            title="Quote asset"
          >
            <option value="USDT">USDT</option>
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
            <option value="BNB">BNB</option>
            <option value="FDUSD">FDUSD</option>
          </select>

          <input
            type="number"
            value={minVolumeRaw}
            onChange={(e) => setMinVolumeRaw(e.target.value)}
            placeholder="Vol≥"
            className="w-16 bg-[#111] border border-[#1e1e1e] rounded px-1 py-px text-[10px] text-[#999] focus:border-blue-500/50 outline-none tabular-nums placeholder:text-[#444]"
            title="Min 24h volume"
          />

          <input
            type="number"
            value={minChangePctRaw}
            onChange={(e) => setMinChangePctRaw(e.target.value)}
            placeholder="Δ%≥"
            className="w-12 bg-[#111] border border-[#1e1e1e] rounded px-1 py-px text-[10px] text-[#999] focus:border-blue-500/50 outline-none tabular-nums placeholder:text-[#444]"
            title="Min % change"
          />

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortField)}
            className="bg-[#111] border border-[#1e1e1e] rounded px-1 py-px text-[10px] text-[#999] focus:border-blue-500/50 outline-none"
            title="Sort by"
          >
            <option value="quoteVolume">Vol</option>
            <option value="priceChangePercent">%Chg</option>
            <option value="lastPrice">Price</option>
            <option value="count">Trades</option>
          </select>

          <label
            className="flex items-center gap-0.5 text-[10px] text-[#555] cursor-pointer"
            title="Exclude leveraged tokens"
          >
            <input
              type="checkbox"
              checked={excludeLeveraged}
              onChange={(e) => setExcludeLeveraged(e.target.checked)}
              className="accent-blue-500 w-3 h-3"
            />
            Lev
          </label>
        </div>

        <Sep />

        {/* ── GROUP: Overlays ── */}
        <button
          onClick={handleToggleSMA}
          className={`px-1.5 py-px text-[10px] rounded border transition-colors shrink-0 ${
            showSMA
              ? "bg-[#1e1e1e] border-purple-500/40 text-purple-400"
              : "border-[#1e1e1e] text-[#555] hover:text-[#888]"
          }`}
          title="Toggle SMA overlays (m)"
        >
          SMA
        </button>

        <Sep />

        {/* ── GROUP: Actions ── */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={handleStar}
            className={`text-sm leading-none px-1 transition-colors ${
              starred ? "text-yellow-400" : "text-[#333] hover:text-[#555]"
            }`}
            title="Star (s)"
          >
            {starred ? "★" : "☆"}
          </button>
          <button
            onClick={handleSkip}
            className={`text-[10px] px-1 transition-colors ${
              isSkipped
                ? "text-[#666]"
                : "text-[#333] hover:text-[#555]"
            }`}
            title="Skip/unskip (x)"
          >
            {isSkipped ? "✕" : "—"}
          </button>
        </div>

        <Sep />

        {/* ── GROUP: Tools ── */}
        <div className="flex items-center gap-0 shrink-0">
          <button
            onClick={openSearch}
            className="text-[#555] hover:text-[#888] transition-colors px-1 text-[11px]"
            title="Search (/)"
          >
            /
          </button>

          {/* Settings */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="text-[#555] hover:text-[#888] transition-colors px-1 text-[11px]"
              title="Settings"
            >
              ⚙
            </button>
            {showSettings && (
              <div className="absolute top-full right-0 mt-1 bg-[#141414] border border-[#222] rounded shadow-lg z-50 min-w-[180px] p-2 space-y-2">
                <label className="flex items-center justify-between text-[11px] text-[#aaa]">
                  Prefetch depth
                  <select
                    value={prefetchDepth}
                    onChange={(e) =>
                      setPrefetchDepth(parseInt(e.target.value, 10))
                    }
                    className="bg-[#111] border border-[#222] rounded px-1.5 py-0.5 text-[11px] text-[#ccc] outline-none ml-2"
                  >
                    <option value="3">3</option>
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="20">20</option>
                  </select>
                </label>
                <div className="text-[10px] text-[#444] pt-1 border-t border-[#222]">
                  Skipped: {skipped.size}
                  {skipped.size > 0 && (
                    <button
                      onClick={() => {
                        setSkipped(new Set());
                        saveSkipped(new Set());
                      }}
                      className="ml-2 text-blue-400 hover:text-blue-300"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Favorites menu */}
          <div className="relative" ref={favMenuRef}>
            <button
              onClick={() => setShowFavMenu((v) => !v)}
              className="text-[#555] hover:text-[#888] transition-colors px-1 text-[11px]"
              title="More"
            >
              ⋯
            </button>
            {showFavMenu && (
              <div className="absolute top-full right-0 mt-1 bg-[#141414] border border-[#222] rounded shadow-lg z-50 min-w-[140px]">
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
      </div>

      {/* ── Note editing bar (only when actively editing) ── */}
      {editingNote && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-[#1a1a1a] shrink-0 text-[11px]">
          <span className="text-[#555]">Note:</span>
          <input
            ref={noteInputRef}
            type="text"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onBlur={saveNote}
            placeholder="Add a note... (Enter to save, Esc to cancel)"
            className="flex-1 bg-transparent text-[#ccc] placeholder:text-[#444] outline-none border-b border-[#333] pb-px"
            maxLength={120}
          />
        </div>
      )}

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
            <CandleChart
              candles={currentCandles}
              symbol={currentTicker?.symbol}
              timeframeLabel={tfObj.label}
              showSMA={showSMA}
            />
          </>
        )}
      </div>

      {/* ── Footer: keyboard hints ── */}
      <div className="flex items-center justify-center gap-4 px-3 py-1 border-t border-[#1a1a1a] shrink-0 text-[10px] text-[#444] flex-wrap">
        <span>
          <Kbd>←</Kbd> <Kbd>→</Kbd> nav
        </span>
        <span>
          <Kbd>s</Kbd> star
        </span>
        <span>
          <Kbd>x</Kbd> skip
        </span>
        <span>
          <Kbd>m</Kbd> SMA
        </span>
        <span>
          <Kbd>t</Kbd> timeframe
        </span>
        <span>
          <Kbd>/</Kbd> search
        </span>
        <span>
          <Kbd>n</Kbd> note
        </span>
      </div>
    </div>
  );
}

function Sep() {
  return <div className="w-px h-4 bg-[#1a1a1a] mx-1.5 shrink-0" />;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1 py-px bg-[#141414] border border-[#222] rounded text-[10px] text-[#555] leading-tight">
      {children}
    </kbd>
  );
}
