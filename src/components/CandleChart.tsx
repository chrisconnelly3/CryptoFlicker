"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import type { CandleData } from "@/lib/types";
import { formatPrice, formatVolume, formatPct, formatDate } from "@/lib/format";
import { computeSMA, computeVolumeMA } from "@/lib/indicators";

export interface CrosshairData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  changePct: number;
  volume: number;
}

interface Props {
  candles: CandleData[];
  symbol?: string;
  timeframeLabel?: string;
  showSMA: boolean;
}

export default function CandleChart({ candles, symbol, timeframeLabel, showSMA }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const volMaRef = useRef<ISeriesApi<"Line"> | null>(null);

  const [crosshair, setCrosshair] = useState<CrosshairData | null>(null);

  const candlesRef = useRef<CandleData[]>([]);
  candlesRef.current = candles;

  const handleCrosshairMove = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (param: any) => {
      if (
        !param ||
        !param.time ||
        !param.seriesData ||
        param.seriesData.size === 0
      ) {
        setCrosshair(null);
        return;
      }

      const cs = candleSeriesRef.current;
      if (!cs) return;

      const d = param.seriesData.get(cs) as
        | CandlestickData<UTCTimestamp>
        | undefined;
      if (!d) {
        setCrosshair(null);
        return;
      }

      const changePct = d.open !== 0 ? ((d.close - d.open) / d.open) * 100 : 0;
      const ts = typeof param.time === "number" ? param.time : 0;

      const candle = candlesRef.current.find((c) => c.time === ts);

      setCrosshair({
        date: formatDate(ts),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        changePct,
        volume: candle?.volume ?? 0,
      });
    },
    []
  );

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0a" },
        textColor: "#555",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.03)" },
      },
      crosshair: {
        vertLine: {
          color: "rgba(255,255,255,0.15)",
          labelBackgroundColor: "#1a1a1a",
        },
        horzLine: {
          color: "rgba(255,255,255,0.15)",
          labelBackgroundColor: "#1a1a1a",
        },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: false,
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // SMA lines
    const sma50 = chart.addSeries(LineSeries, {
      color: "rgba(59, 130, 246, 0.6)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const sma200 = chart.addSeries(LineSeries, {
      color: "rgba(168, 85, 247, 0.6)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Volume MA line
    const volMa = chart.addSeries(LineSeries, {
      color: "rgba(234, 179, 8, 0.5)",
      lineWidth: 1,
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chart.subscribeCrosshairMove(handleCrosshairMove);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    sma50Ref.current = sma50;
    sma200Ref.current = sma200;
    volMaRef.current = volMa;

    return () => {
      chart.remove();
    };
  }, [handleCrosshairMove]);

  // Update data
  useEffect(() => {
    if (
      !candleSeriesRef.current ||
      !volumeSeriesRef.current ||
      candles.length === 0
    )
      return;

    const cData: CandlestickData<UTCTimestamp>[] = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const vData: HistogramData<UTCTimestamp>[] = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color:
        c.close >= c.open
          ? "rgba(34, 197, 94, 0.35)"
          : "rgba(239, 68, 68, 0.35)",
    }));

    candleSeriesRef.current.setData(cData);
    volumeSeriesRef.current.setData(vData);

    // SMA overlays
    if (showSMA && sma50Ref.current && sma200Ref.current) {
      const sma50Data = computeSMA(candles, 50).map((d) => ({
        time: d.time as UTCTimestamp,
        value: d.value,
      })) as LineData<UTCTimestamp>[];
      const sma200Data = computeSMA(candles, 200).map((d) => ({
        time: d.time as UTCTimestamp,
        value: d.value,
      })) as LineData<UTCTimestamp>[];
      sma50Ref.current.setData(sma50Data);
      sma200Ref.current.setData(sma200Data);
    } else {
      sma50Ref.current?.setData([]);
      sma200Ref.current?.setData([]);
    }

    // Volume MA overlay
    if (showSMA && volMaRef.current) {
      const volMaData = computeVolumeMA(candles, 20).map((d) => ({
        time: d.time as UTCTimestamp,
        value: d.value,
      })) as LineData<UTCTimestamp>[];
      volMaRef.current.setData(volMaData);
    } else {
      volMaRef.current?.setData([]);
    }

    chartRef.current?.timeScale().fitContent();
    setCrosshair(null);
  }, [candles, showSMA]);

  const watermark =
    symbol || timeframeLabel
      ? [symbol, timeframeLabel].filter(Boolean).join(" · ")
      : null;

  const chColor =
    crosshair && crosshair.changePct >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="relative w-full h-full min-h-0">
      {/* Watermark */}
      {watermark && (
        <div className="absolute top-3 left-4 z-10 pointer-events-none select-none text-[13px] font-semibold tracking-wider text-white/[0.06]">
          {watermark}
        </div>
      )}

      {/* Crosshair legend */}
      {crosshair && (
        <div className="absolute top-2 right-4 z-20 pointer-events-none select-none flex items-center gap-3 text-[10px] tabular-nums">
          <span className="text-[#666]">{crosshair.date}</span>
          <span className="text-[#777]">
            O{" "}
            <span className="text-[#aaa]">
              {formatPrice(crosshair.open)}
            </span>
          </span>
          <span className="text-[#777]">
            H{" "}
            <span className="text-[#aaa]">
              {formatPrice(crosshair.high)}
            </span>
          </span>
          <span className="text-[#777]">
            L{" "}
            <span className="text-[#aaa]">
              {formatPrice(crosshair.low)}
            </span>
          </span>
          <span className="text-[#777]">
            C{" "}
            <span className="text-[#aaa]">
              {formatPrice(crosshair.close)}
            </span>
          </span>
          <span className={chColor}>{formatPct(crosshair.changePct)}</span>
          <span className="text-[#777]">
            Vol{" "}
            <span className="text-[#aaa]">
              {formatVolume(crosshair.volume)}
            </span>
          </span>
        </div>
      )}

      {/* SMA legend */}
      {showSMA && (
        <div className="absolute bottom-2 left-4 z-20 pointer-events-none select-none flex items-center gap-4 text-[9px]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-px bg-blue-500/60" />
            <span className="text-blue-400/70">SMA 50</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-px bg-purple-500/60" />
            <span className="text-purple-400/70">SMA 200</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-px bg-yellow-500/50" />
            <span className="text-yellow-400/60">Vol MA 20</span>
          </span>
        </div>
      )}

      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
