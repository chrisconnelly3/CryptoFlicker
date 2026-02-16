export type AssetClass = "crypto" | "equity";

/** Crypto-specific 24h ticker snapshot from Binance */
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

/** Lightweight universal instrument used for the flip-list */
export interface Instrument {
  symbol: string;
  name?: string;
  assetClass: AssetClass;
  exchange?: string;
  lastPrice: number;
  priceChangePercent: number;
  volume: number;
}

export interface CandleData {
  time: number; // UTCTimestamp (seconds since epoch)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
