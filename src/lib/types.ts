export interface Ticker {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
  count: number;
}

export interface CandleData {
  time: number; // UTCTimestamp (seconds since epoch)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
