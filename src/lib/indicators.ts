import type { CandleData } from "./types";

export function computeSMA(
  candles: CandleData[],
  period: number
): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  if (candles.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  result.push({ time: candles[period - 1].time, value: sum / period });

  for (let i = period; i < candles.length; i++) {
    sum += candles[i].close - candles[i - period].close;
    result.push({ time: candles[i].time, value: sum / period });
  }
  return result;
}

export function computeVolumeMA(
  candles: CandleData[],
  period: number
): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  if (candles.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].volume;
  }
  result.push({ time: candles[period - 1].time, value: sum / period });

  for (let i = period; i < candles.length; i++) {
    sum += candles[i].volume - candles[i - period].volume;
    result.push({ time: candles[i].time, value: sum / period });
  }
  return result;
}
