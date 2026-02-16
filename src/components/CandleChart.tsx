"use client";

import { useRef, useEffect } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
} from "lightweight-charts";
import type { CandleData } from "@/lib/types";

interface Props {
  candles: CandleData[];
}

export default function CandleChart({ candles }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Create chart once on mount
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
        vertLine: { color: "rgba(255,255,255,0.15)", labelBackgroundColor: "#1a1a1a" },
        horzLine: { color: "rgba(255,255,255,0.15)", labelBackgroundColor: "#1a1a1a" },
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

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
    };
  }, []);

  // Update data when candles change
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || candles.length === 0) return;

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
      color: c.close >= c.open ? "rgba(34, 197, 94, 0.35)" : "rgba(239, 68, 68, 0.35)",
    }));

    candleSeriesRef.current.setData(cData);
    volumeSeriesRef.current.setData(vData);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return <div ref={containerRef} className="w-full h-full min-h-0" />;
}
