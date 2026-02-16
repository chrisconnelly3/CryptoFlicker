"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import CandleChart from "@/components/CandleChart";
import { useFavorites } from "@/hooks/useFavorites";
import { formatPrice, formatVolume, formatPct } from "@/lib/format";
import type { Ticker, CandleData, Instrument, AssetClass } from "@/lib/types";

type View = "all" | "favorites";
type SortField = "quoteVolume" | "priceChangePercent" | "lastPrice" | "count";
type CacheStatus = "idle" | "cached" | "fetching" | "error";
type AssetFilter = "crypto" | "equity" | "both";

const TIMEFRAMES = [
  { value: "1d", label: "1D", tooltip: "Each candlestick = 1 day" },
  { value: "4h", label: "4H", tooltip: "Each candlestick = 4 hours" },
  { value: "1w", label: "1W", tooltip: "Each candlestick = 1 week" },
] as const;

const SESSION_KEY = "cryptoflicker:session";
const SKIP_KEY = "cryptoflicker:skipped";
const EMPTY_TICKERS: Ticker[] = [];
const EMPTY_INSTRUMENTS: Instrument[] = [];

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

function tickerToInstrument(t: Ticker): Instrument {
  return {
    symbol: t.symbol,
    name: `${t.baseAsset}/${t.quoteAsset}`,
    assetClass: "crypto",
    exchange: "Binance",
    lastPrice: t.lastPrice,
    priceChangePercent: t.priceChangePercent,
    volume: t.quoteVolume,
  };
}

function instrumentKey(inst: Instrument): string {
  return `${inst.assetClass}:${inst.symbol}`;
}

export default function ScreenerPage() {
  /* ── Asset class filter ── */
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("crypto");

  /* ── Crypto filters ── */
  const [quoteAsset, setQuoteAsset] = useState("USDT");
  const [minVolumeRaw, setMinVolumeRaw] = useState("");
  const [minChangePctRaw, setMinChangePctRaw] = useState("");
  const [excludeLeveraged, setExcludeLeveraged] = useState(true);
  const [sortBy, setSortBy] = useState<SortField>("quoteVolume");

  const minVolume = useDebounced(minVolumeRaw, 400);
  const minChangePct = useDebounced(minChangePctRaw, 400);

  /* ── Universal filter: minimum average daily volume ── */
  const [minAvgVolRaw, setMinAvgVolRaw] = useState("");
  const minAvgVol = useDebounced(minAvgVolRaw, 400);
  const minAvgVolNum = minAvgVol ? parseFloat(minAvgVol) : 0;

  /* ── Timeframe ── */
  const [interval, setInterval_] = useState("1d");
  const tfObj = TIMEFRAMES.find((t) => t.value === interval) ?? TIMEFRAMES[0];

  /* ── Crypto data ── */
  const [cryptoTickers, setCryptoTickers] = useState<Ticker[]>(EMPTY_TICKERS);
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [cryptoError, setCryptoError] = useState("");

  /* ── Equity data ── */
  const [equityInstruments, setEquityInstruments] = useState<Instrument[]>(EMPTY_INSTRUMENTS);
  const [equityLoading, setEquityLoading] = useState(false);
  const [equityError, setEquityError] = useState("");

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

  /* ── Prefetch depth (hardcoded) ── */
  const prefetchDepth = 5;

  /* ── Refs ── */
  const candleCacheRef = useRef(new Map<string, CandleData[]>());
  const abortRef = useRef<AbortController | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const favMenuRef = useRef<HTMLDivElement>(null);
  const initDone = useRef(false);
  const assetFilterRef = useRef<AssetFilter>("crypto");

  // Track whether equities have been fetched at least once to avoid re-fetching
  const equitiesFetchedRef = useRef(false);

  /* ── Load session + skipped on mount ── */
  useEffect(() => {
    const s = loadSession();
    const p = new URLSearchParams(window.location.search);

    const restoredAc = (p.get("ac") ?? s.assetFilter ?? "crypto") as AssetFilter;
    setAssetFilter(restoredAc);
    assetFilterRef.current = restoredAc;
    setQuoteAsset(p.get("q") ?? s.quoteAsset ?? "USDT");
    setMinVolumeRaw(p.get("minVol") ?? s.minVolumeRaw ?? "");
    setMinChangePctRaw(p.get("minPct") ?? s.minChangePctRaw ?? "");
    setMinAvgVolRaw(p.get("minAvgVol") ?? s.minAvgVolRaw ?? "");
    setSortBy((p.get("sort") ?? s.sortBy ?? "quoteVolume") as SortField);
    setExcludeLeveraged(
      p.has("exlev") ? p.get("exlev") !== "0" : s.excludeLeveraged !== "false",
    );
    setView((p.get("view") ?? s.view ?? "all") as View);
    setInterval_(p.get("tf") ?? s.interval ?? "1d");
    if (s.showSMA === "true") setShowSMA(true);

    const savedIdx = parseInt(s.currentIndex ?? "0", 10);
    if (savedIdx > 0) {
      setCurrentIndex(savedIdx);
    }

    setSkipped(loadSkipped());
    initDone.current = true;
  }, []);

  // Keep ref in sync for closures
  useEffect(() => {
    assetFilterRef.current = assetFilter;
  }, [assetFilter]);

  /* ── Persist session ── */
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const params = new URLSearchParams();
    if (assetFilter !== "crypto") params.set("ac", assetFilter);
    if (quoteAsset !== "USDT") params.set("q", quoteAsset);
    if (minVolumeRaw) params.set("minVol", minVolumeRaw);
    if (minChangePctRaw) params.set("minPct", minChangePctRaw);
    if (minAvgVolRaw) params.set("minAvgVol", minAvgVolRaw);
    if (sortBy !== "quoteVolume") params.set("sort", sortBy);
    if (!excludeLeveraged) params.set("exlev", "0");
    if (view !== "all") params.set("view", view);
    if (interval !== "1d") params.set("tf", interval);

    const qs = params.toString();
    const url = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    window.history.replaceState(null, "", url);

    saveSession({
      assetFilter,
      quoteAsset,
      minVolumeRaw,
      minChangePctRaw,
      minAvgVolRaw,
      sortBy,
      excludeLeveraged: String(excludeLeveraged),
      view,
      interval,
      currentIndex: String(currentIndex),
      showSMA: String(showSMA),
    });
  }, [
    assetFilter,
    quoteAsset,
    minVolumeRaw,
    minChangePctRaw,
    minAvgVolRaw,
    sortBy,
    excludeLeveraged,
    view,
    interval,
    currentIndex,
    showSMA,
  ]);

  /* ── Close menus on outside click ── */
  useEffect(() => {
    if (!showFavMenu) return;
    function onClick(e: MouseEvent) {
      if (
        showFavMenu &&
        favMenuRef.current &&
        !favMenuRef.current.contains(e.target as Node)
      ) {
        setShowFavMenu(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showFavMenu]);

  /* ── Build unified instrument list ── */
  const cryptoInstruments = useMemo(
    () => cryptoTickers.map(tickerToInstrument),
    [cryptoTickers],
  );

  const allInstruments = useMemo(() => {
    if (assetFilter === "crypto") return cryptoInstruments;
    if (assetFilter === "equity") return equityInstruments;
    return [...cryptoInstruments, ...equityInstruments];
  }, [assetFilter, cryptoInstruments, equityInstruments]);

  /* ── Track instruments known to be below min avg volume ── */
  const [belowVolSet, setBelowVolSet] = useState<Set<string>>(new Set());

  const activeList = useMemo(() => {
    let list = allInstruments;
    if (view === "favorites") {
      list = list.filter((inst) => favorites.has(instrumentKey(inst)));
    }
    // Filter out instruments known to be below min avg volume threshold
    if (belowVolSet.size > 0) {
      list = list.filter((inst) => !belowVolSet.has(instrumentKey(inst)));
    }
    return list;
  }, [allInstruments, view, favorites, belowVolSet]);

  const currentInstrument = activeList[currentIndex] ?? null;
  const isSkipped = currentInstrument
    ? skipped.has(instrumentKey(currentInstrument))
    : false;

  /* ── Clamp index ── */
  useEffect(() => {
    if (activeList.length > 0 && currentIndex >= activeList.length) {
      setCurrentIndex(Math.max(0, activeList.length - 1));
    }
  }, [activeList.length, currentIndex]);

  /* ── Fetch crypto tickers ── */
  useEffect(() => {
    // Don't fetch crypto data when in equity-only mode.
    // Use stable empty reference to avoid re-renders.
    if (assetFilter === "equity") {
      setCryptoTickers(EMPTY_TICKERS);
      return;
    }

    const controller = new AbortController();
    setCryptoLoading(true);
    setCryptoError("");

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
        setCryptoTickers(data);
        // Only reset crypto index when filters change (not on initial load).
        // Use ref to avoid stale closure reading of assetFilter.
        if (assetFilterRef.current === "crypto") {
          setCurrentIndex((prev) => (prev >= data.length ? 0 : prev));
        }
        setCryptoLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.error(err);
        setCryptoError("Failed to load crypto tickers.");
        setCryptoLoading(false);
      });

    return () => controller.abort();
  }, [
    assetFilter,
    quoteAsset,
    minVolume,
    minChangePct,
    excludeLeveraged,
    sortBy,
  ]);

  /* ── Fetch equity universe (once, then cache) ── */
  useEffect(() => {
    if (assetFilter === "crypto") {
      return;
    }

    // Don't re-fetch if we already have equity data
    if (equitiesFetchedRef.current && equityInstruments.length > 0) {
      return;
    }

    const controller = new AbortController();
    setEquityLoading(true);
    setEquityError("");

    fetch("/api/market/equities/universe", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Instrument[]) => {
        setEquityInstruments(data);
        equitiesFetchedRef.current = true;
        setEquityLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.error(err);
        setEquityError("Failed to load equities.");
        setEquityLoading(false);
      });

    return () => controller.abort();
  }, [assetFilter, equityInstruments.length]);

  /* ── Clear candle cache + volume filter when timeframe changes ── */
  useEffect(() => {
    candleCacheRef.current.clear();
    setBelowVolSet(new Set());
  }, [interval]);

  /* ── Fetch candles + prefetch ── */
  const fetchCandles = useCallback(
    async (
      symbol: string,
      assetClass: AssetClass,
      signal?: AbortSignal,
    ): Promise<CandleData[]> => {
      const cacheKey = `${assetClass}:${symbol}:${interval}`;
      const cached = candleCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const params = new URLSearchParams({
        symbol,
        interval,
        assetClass,
      });

      const res = await fetch(`/api/market/candles?${params}`, { signal });
      if (!res.ok) throw new Error(`${res.status}`);
      const data: CandleData[] = await res.json();
      candleCacheRef.current.set(cacheKey, data);
      return data;
    },
    [interval],
  );

  useEffect(() => {
    if (!activeList.length || !currentInstrument) {
      setCurrentCandles([]);
      setCacheStatus("idle");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const sym = currentInstrument.symbol;
    const ac = currentInstrument.assetClass;
    const cacheKey = `${ac}:${sym}:${interval}`;

    const cached = candleCacheRef.current.get(cacheKey);
    if (cached) {
      setCurrentCandles(cached);
      setCandlesLoading(false);
      setCacheStatus("cached");
    } else {
      setCandlesLoading(true);
      setCacheStatus("fetching");
    }

    fetchCandles(sym, ac, controller.signal)
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

    for (let i = 1; i <= prefetchDepth; i++) {
      const idx = currentIndex + i;
      if (idx < activeList.length) {
        const next = activeList[idx];
        fetchCandles(next.symbol, next.assetClass, controller.signal).catch(
          () => {},
        );
      }
    }
    for (let i = 1; i <= 2; i++) {
      const idx = currentIndex - i;
      if (idx >= 0) {
        const prev = activeList[idx];
        fetchCandles(prev.symbol, prev.assetClass, controller.signal).catch(
          () => {},
        );
      }
    }
  }, [
    currentIndex,
    activeList,
    currentInstrument,
    fetchCandles,
    interval,
    prefetchDepth,
  ]);

  /* ── Derive equity stats from candles ── */
  const derivedStats = useMemo(() => {
    if (
      !currentInstrument ||
      currentInstrument.assetClass !== "equity" ||
      currentCandles.length < 2
    ) {
      return null;
    }
    const last = currentCandles[currentCandles.length - 1];
    const prev = currentCandles[currentCandles.length - 2];
    return {
      lastPrice: last.close,
      priceChangePercent: ((last.close - prev.close) / prev.close) * 100,
      volume: last.volume,
    };
  }, [currentInstrument, currentCandles]);

  /* ── Compute average daily volume for current instrument ── */
  const avgDailyVolume = useMemo(() => {
    if (!currentCandles.length || !currentInstrument) return 0;
    const recent = currentCandles.slice(-20);
    const total = recent.reduce((sum, c) => sum + c.volume, 0);
    return total / recent.length;
  }, [currentCandles, currentInstrument]);

  useEffect(() => {
    if (
      minAvgVolNum <= 0 ||
      !currentInstrument ||
      currentCandles.length === 0 ||
      candlesLoading
    )
      return;

    const key = instrumentKey(currentInstrument);
    const avg = avgDailyVolume;
    if (avg > 0 && avg < minAvgVolNum) {
      setBelowVolSet((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    } else if (avg >= minAvgVolNum) {
      setBelowVolSet((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [avgDailyVolume, minAvgVolNum, currentInstrument, currentCandles.length, candlesLoading]);

  // Clear belowVolSet when minAvgVol changes (user changed threshold)
  const prevMinAvgVolNum = useRef(minAvgVolNum);
  useEffect(() => {
    if (prevMinAvgVolNum.current !== minAvgVolNum) {
      setBelowVolSet(new Set());
      prevMinAvgVolNum.current = minAvgVolNum;
    }
  }, [minAvgVolNum]);

  /* ── Navigation callbacks ── */
  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, activeList.length - 1));
  }, [activeList.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  /* ── Swipe gesture handling for mobile ── */
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
  }, []);
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchRef.current) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchRef.current.x;
      const dy = touch.clientY - touchRef.current.y;
      const dt = Date.now() - touchRef.current.t;
      touchRef.current = null;
      if (dt > 500 || Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx))
        return;
      if (dx < 0) goNext();
      else goPrev();
    },
    [goNext, goPrev],
  );

  const handleStar = useCallback(() => {
    if (currentInstrument) toggleFav(instrumentKey(currentInstrument));
  }, [currentInstrument, toggleFav]);

  const handleSkip = useCallback(() => {
    if (!currentInstrument) return;
    const key = instrumentKey(currentInstrument);
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveSkipped(next);
      return next;
    });
  }, [currentInstrument]);

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
    const idx = activeList.findIndex(
      (inst) =>
        inst.symbol.includes(q) ||
        (inst.name?.toUpperCase().includes(q) ?? false),
    );
    if (idx >= 0) {
      setCurrentIndex(idx);
    }
    closeSearch();
  }, [searchQuery, activeList, closeSearch]);

  /* ── Note editing ── */
  const startEditNote = useCallback(() => {
    if (!currentInstrument) return;
    setNoteValue(getNote(instrumentKey(currentInstrument)));
    setEditingNote(true);
    setTimeout(() => noteInputRef.current?.focus(), 0);
  }, [currentInstrument, getNote]);

  const saveNote = useCallback(() => {
    if (currentInstrument) {
      setNote(instrumentKey(currentInstrument), noteValue);
    }
    setEditingNote(false);
  }, [currentInstrument, noteValue, setNote]);

  /* ── Keyboard ── */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
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

  /* ── Reset index on explicit user-driven view / asset class switch ── */
  const prevView = useRef(view);
  const prevAssetFilter = useRef(assetFilter);
  useEffect(() => {
    // Only reset index for explicit user-initiated changes, not initial mount.
    if (!initDone.current) return;
    if (view !== prevView.current || assetFilter !== prevAssetFilter.current) {
      // Only reset if it was a real change from a previous value (not mount)
      if (prevView.current !== view) {
        setCurrentIndex(0);
      }
      if (prevAssetFilter.current !== assetFilter) {
        setCurrentIndex(0);
      }
      prevView.current = view;
      prevAssetFilter.current = assetFilter;
    }
  }, [view, assetFilter]);

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
    [importFavorites],
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

  /* ── Loading / Error ── */
  const isLoading =
    (assetFilter !== "equity" && cryptoLoading) ||
    (assetFilter !== "crypto" && equityLoading);

  const errorMsg = cryptoError || equityError;

  if (isLoading && allInstruments.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen">
        <span className="text-sm text-[#555] animate-pulse">
          Loading {assetFilter === "both" ? "instruments" : assetFilter === "equity" ? "equities" : "tickers"}...
        </span>
      </div>
    );
  }

  if (errorMsg && allInstruments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <span className="text-sm text-red-400">{errorMsg}</span>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-1.5 text-xs bg-[#1a1a1a] border border-[#333] rounded hover:bg-[#222] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  /* ── Computed display values ── */
  const displayPrice =
    currentInstrument?.assetClass === "equity" && derivedStats
      ? derivedStats.lastPrice
      : currentInstrument?.lastPrice ?? 0;
  const displayPct =
    currentInstrument?.assetClass === "equity" && derivedStats
      ? derivedStats.priceChangePercent
      : currentInstrument?.priceChangePercent ?? 0;
  const displayVol =
    currentInstrument?.assetClass === "equity" && derivedStats
      ? derivedStats.volume
      : currentInstrument?.volume ?? 0;

  const pctColor = displayPct >= 0 ? "text-green-400" : "text-red-400";
  const starred = currentInstrument
    ? isFavorite(instrumentKey(currentInstrument))
    : false;
  const currentNote = currentInstrument
    ? getNote(instrumentKey(currentInstrument))
    : "";
  const statusColor =
    cacheStatus === "cached"
      ? "bg-green-500"
      : cacheStatus === "fetching"
        ? "bg-amber-500 animate-pulse"
        : cacheStatus === "error"
          ? "bg-red-500"
          : "bg-[#333]";

  const isCryptoMode = assetFilter === "crypto" || assetFilter === "both";

  // Show filtered count hint when volume filter is active
  const volFilterActive = minAvgVolNum > 0 && belowVolSet.size > 0;

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
                  .map((inst, i) => ({ inst, i }))
                  .filter(
                    ({ inst }) =>
                      inst.symbol
                        .toUpperCase()
                        .includes(searchQuery.toUpperCase()) ||
                      (inst.name
                        ?.toUpperCase()
                        .includes(searchQuery.toUpperCase()) ??
                        false),
                  )
                  .slice(0, 10)
                  .map(({ inst, i }) => (
                    <button
                      key={instrumentKey(inst)}
                      onClick={() => {
                        setCurrentIndex(i);
                        closeSearch();
                      }}
                      className="block w-full text-left px-2 py-1 hover:bg-[#1a1a1a] text-[#aaa] rounded transition-colors"
                    >
                      <span className="text-white">{inst.symbol}</span>{" "}
                      {inst.name && (
                        <span className="text-[#555] truncate">
                          {inst.name}
                        </span>
                      )}
                      <span
                        className={`ml-1 text-[9px] px-1 rounded ${
                          inst.assetClass === "crypto"
                            ? "bg-blue-500/20 text-blue-400"
                            : "bg-emerald-500/20 text-emerald-400"
                        }`}
                      >
                        {inst.assetClass === "crypto" ? "CRYPTO" : "EQUITY"}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          UNIFIED TOOLBAR
          ══════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-x-0 gap-y-0.5 px-1 py-1 border-b border-[#1a1a1a] shrink-0 text-[11px]">
        {/* ── GROUP: Navigation ── */}
        <div className="flex items-center shrink-0">
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="px-2 py-1.5 md:px-1.5 md:py-0.5 text-[14px] md:text-[11px] text-[#555] hover:text-white disabled:opacity-20 transition-colors"
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
            className="px-2 py-1.5 md:px-1.5 md:py-0.5 text-[14px] md:text-[11px] text-[#555] hover:text-white disabled:opacity-20 transition-colors"
            title="Next (→ or l)"
          >
            ▶
          </button>
        </div>

        <Sep />

        {/* ── GROUP: Ticker context ── */}
        {currentInstrument ? (
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <span
              className={`text-[9px] px-1 py-px rounded font-medium shrink-0 ${
                currentInstrument.assetClass === "crypto"
                  ? "bg-blue-500/20 text-blue-400"
                  : "bg-emerald-500/20 text-emerald-400"
              }`}
            >
              {currentInstrument.assetClass === "crypto" ? "CRYPTO" : "EQUITY"}
            </span>
            <span
              className={`text-[12px] font-bold tracking-wide leading-none whitespace-nowrap ${
                isSkipped ? "text-[#444] line-through" : "text-white"
              }`}
            >
              {currentInstrument.symbol}
            </span>
            {displayPrice > 0 && (
              <span className="text-[11px] text-[#999] tabular-nums leading-none whitespace-nowrap">
                {formatPrice(displayPrice)}
              </span>
            )}
            {(displayPrice > 0 || currentInstrument.assetClass === "crypto") && (
              <span
                className={`text-[11px] font-semibold tabular-nums leading-none whitespace-nowrap ${pctColor}`}
              >
                {formatPct(displayPct)}
              </span>
            )}
            {displayVol > 0 && (
              <span className="text-[10px] text-[#555] tabular-nums leading-none whitespace-nowrap hidden sm:inline">
                {formatVolume(displayVol)}
              </span>
            )}
            {avgDailyVolume > 0 && (
              <span className="text-[9px] tabular-nums leading-none whitespace-nowrap hidden md:inline text-[#444]">
                avg:{formatVolume(avgDailyVolume)}
              </span>
            )}
            {currentInstrument.name && (
              <span className="text-[10px] text-[#555] leading-none whitespace-nowrap hidden lg:inline truncate max-w-32">
                {currentInstrument.name}
              </span>
            )}
            {currentNote && !editingNote && (
              <button
                onClick={startEditNote}
                className="text-[10px] text-[#555] hover:text-[#888] truncate max-w-28 leading-none transition-colors whitespace-nowrap hidden md:inline"
                title={`Note: ${currentNote} (n to edit)`}
              >
                &ldquo;{currentNote}&rdquo;
              </button>
            )}
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`}
              title={`${cacheStatus}`}
            />
          </div>
        ) : (
          <span className="text-[11px] text-[#444] px-1">No symbol</span>
        )}

        {/* ── Spacer ── */}
        <div className="flex-1 min-w-2" />

        {/* ── GROUP: Actions ── */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={handleStar}
            className={`text-lg md:text-sm leading-none px-2 py-1.5 md:px-1 md:py-0 transition-colors ${
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

        {/* ── ROW 2: wraps below on small screens ── */}
        <div className="flex items-center gap-1.5 flex-wrap w-full mt-0.5 pt-0.5 border-t border-[#111]">
          {/* Asset class toggle */}
          <div className="flex rounded overflow-hidden border border-[#1e1e1e] shrink-0">
            {(["crypto", "equity", "both"] as const).map((ac) => (
              <button
                key={ac}
                onClick={() => setAssetFilter(ac)}
                className={`px-2 py-px text-[10px] transition-colors ${
                  assetFilter === ac
                    ? ac === "crypto"
                      ? "bg-[#1e1e1e] text-blue-400"
                      : ac === "equity"
                        ? "bg-[#1e1e1e] text-emerald-400"
                        : "bg-[#1e1e1e] text-[#ccc]"
                    : "text-[#555] hover:text-[#888]"
                }`}
              >
                {ac === "crypto" ? "Crypto" : ac === "equity" ? "Equities" : "Both"}
              </button>
            ))}
          </div>

          <Sep />

          {/* List view toggle */}
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

          {/* Timeframe toggle */}
          <div className="flex rounded overflow-hidden border border-[#1e1e1e] shrink-0">
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

          <div className="w-px h-3.5 bg-[#1a1a1a] mx-0.5 shrink-0" />

          {/* Minimum average daily volume filter (universal) */}
          <input
            type="number"
            value={minAvgVolRaw}
            onChange={(e) => setMinAvgVolRaw(e.target.value)}
            placeholder="AvgVol≥"
            className="w-20 bg-[#111] border border-[#1e1e1e] rounded px-1 py-px text-[10px] text-[#999] focus:border-blue-500/50 outline-none tabular-nums placeholder:text-[#444] shrink-0"
            title="Min average daily volume (20-day). Instruments below this are auto-skipped."
          />

          {/* Sort (universal) */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortField)}
            className="bg-[#111] border border-[#1e1e1e] rounded px-1 py-px text-[10px] text-[#999] focus:border-blue-500/50 outline-none shrink-0"
            title="Sort by"
          >
            <option value="quoteVolume">Vol</option>
            <option value="priceChangePercent">%Chg</option>
            <option value="lastPrice">Price</option>
            {isCryptoMode && <option value="count">Trades</option>}
          </select>

          {/* Crypto-specific filters */}
          {isCryptoMode && (
            <>
              <div className="w-px h-3.5 bg-[#1a1a1a] mx-0.5 shrink-0" />

              <select
                value={quoteAsset}
                onChange={(e) => setQuoteAsset(e.target.value)}
                className="bg-[#111] border border-[#1e1e1e] rounded px-1 py-px text-[10px] text-[#999] focus:border-blue-500/50 outline-none shrink-0"
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
                className="w-16 bg-[#111] border border-[#1e1e1e] rounded px-1 py-px text-[10px] text-[#999] focus:border-blue-500/50 outline-none tabular-nums placeholder:text-[#444] shrink-0"
                title="Min 24h volume"
              />

              <input
                type="number"
                value={minChangePctRaw}
                onChange={(e) => setMinChangePctRaw(e.target.value)}
                placeholder="Δ%≥"
                className="w-12 bg-[#111] border border-[#1e1e1e] rounded px-1 py-px text-[10px] text-[#999] focus:border-blue-500/50 outline-none tabular-nums placeholder:text-[#444] shrink-0"
                title="Min % change"
              />

              <label
                className="flex items-center gap-0.5 text-[10px] text-[#555] cursor-pointer shrink-0"
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
            </>
          )}

          <div className="w-px h-3.5 bg-[#1a1a1a] mx-0.5 shrink-0" />

          {/* SMA overlay toggle */}
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

          {isLoading && (
            <span className="text-[9px] text-[#555] animate-pulse ml-1">
              loading...
            </span>
          )}
        </div>
      </div>

      {/* ── Volume filter active indicator ── */}
      {volFilterActive && (
        <div className="flex items-center justify-center px-3 py-0.5 bg-blue-500/5 border-b border-blue-500/10 shrink-0">
          <span className="text-[10px] text-blue-400/60">
            AvgVol filter: {belowVolSet.size} hidden (below {formatVolume(minAvgVolNum)})
          </span>
        </div>
      )}

      {/* ── Note editing bar ── */}
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
      <div
        className="flex-1 min-h-0 relative pb-16 md:pb-0"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {activeList.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-[#444]">
              {view === "favorites"
                ? "No favorites yet. Press s to star symbols."
                : assetFilter === "equity"
                  ? "No equities loaded. Check your connection."
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
              symbol={currentInstrument?.symbol}
              timeframeLabel={tfObj.label}
              showSMA={showSMA}
            />
          </>
        )}
      </div>

      {/* ── Mobile: floating thumb-zone navigation ── */}
      {activeList.length > 0 && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 pointer-events-none pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-end justify-between px-2 pb-3">
            <button
              onClick={goPrev}
              disabled={currentIndex === 0}
              className="pointer-events-auto w-14 h-14 rounded-full bg-[#141414]/90 border border-[#222] flex items-center justify-center text-xl text-[#888] active:bg-[#222] active:text-white disabled:opacity-20 transition-colors backdrop-blur-sm"
              aria-label="Previous"
            >
              ◀
            </button>

            <div className="pointer-events-auto flex items-center gap-2 mb-1">
              <button
                onClick={handleSkip}
                className={`w-10 h-10 rounded-full border flex items-center justify-center text-sm transition-colors backdrop-blur-sm ${
                  isSkipped
                    ? "bg-[#222]/90 border-[#444] text-[#888]"
                    : "bg-[#141414]/90 border-[#222] text-[#555] active:bg-[#222] active:text-white"
                }`}
                aria-label="Skip"
              >
                ✕
              </button>
              <button
                onClick={handleStar}
                className={`w-12 h-12 rounded-full border flex items-center justify-center text-xl transition-colors backdrop-blur-sm ${
                  starred
                    ? "bg-yellow-400/20 border-yellow-400/40 text-yellow-400"
                    : "bg-[#141414]/90 border-[#222] text-[#555] active:bg-[#222] active:text-yellow-400"
                }`}
                aria-label="Star"
              >
                {starred ? "★" : "☆"}
              </button>
              <button
                onClick={openSearch}
                className="w-10 h-10 rounded-full bg-[#141414]/90 border border-[#222] flex items-center justify-center text-sm text-[#555] active:bg-[#222] active:text-white transition-colors backdrop-blur-sm"
                aria-label="Search"
              >
                /
              </button>
            </div>

            <button
              onClick={goNext}
              disabled={currentIndex >= activeList.length - 1}
              className="pointer-events-auto w-14 h-14 rounded-full bg-[#141414]/90 border border-[#222] flex items-center justify-center text-xl text-[#888] active:bg-[#222] active:text-white disabled:opacity-20 transition-colors backdrop-blur-sm"
              aria-label="Next"
            >
              ▶
            </button>
          </div>
        </div>
      )}

      {/* ── Footer: keyboard hints (desktop only) ── */}
      <div className="hidden md:flex items-center justify-center gap-4 px-3 py-1 border-t border-[#1a1a1a] shrink-0 text-[10px] text-[#444] flex-wrap">
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
