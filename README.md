# CryptoFlicker

Rapid-fire crypto chart screener. Flip through daily candlestick + volume charts in under 1 second per token. Built for swing-trade evaluation.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS)
- **TradingView Lightweight Charts** (Apache-2.0) for canvas-rendered candlestick + volume charts
- **Binance Spot REST** (free, no API key) for daily OHLCV data and 24h ticker metrics

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000/screener](http://localhost:3000/screener).

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `←` / `h` | Previous symbol |
| `→` / `l` | Next symbol |
| `s` | Star / unstar current symbol |

## Features

- **Instant chart flipping** via single persistent chart instance + prefetch window (next 5 / prev 2 symbols cached client-side)
- **Server-side Binance proxy** with in-memory TTL caching (30s tickers, 10min candles) — avoids CORS and rate-limit issues
- **Filters**: quote asset, min 24h volume, min % change, exclude leveraged tokens, sort by volume/change/price/trades
- **Favorites**: star symbols with `s`, toggle All / Favorites view, export/import as JSON
- **URL-persisted filters**: bookmark or share a filtered screener URL
- **Dark power-user UI**: JetBrains Mono, dense layout, high contrast, keyboard-first

## Environment variables (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `BINANCE_BASE_URL` | (auto-detected) | Override the Binance API base URL. The app automatically tries `api.binance.us` then `api.binance.com`. |

Create a `.env.local` if you need to override:

```
BINANCE_BASE_URL=https://api.binance.us
```
