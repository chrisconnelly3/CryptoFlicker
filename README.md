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
| `x` | Skip / unskip current symbol (session only) |
| `m` | Toggle SMA overlays (50/200 SMA + 20-day Vol MA) |
| `t` | Cycle timeframe (1D / 4H / 1W) |
| `/` | Open quick-jump search |
| `n` | Add/edit note on current symbol |
| `Escape` | Close search / cancel note edit |

## Features

### Core
- **Instant chart flipping** via single persistent chart instance + configurable prefetch window (3/5/10/20 symbols cached client-side)
- **Server-side Binance proxy** with in-memory TTL caching (30s tickers, 10min candles) -- avoids CORS and rate-limit issues
- **Multi-timeframe**: switch between 1D, 4H, and 1W candles with `t` or by clicking the TF chip

### Chart overlays
- **Crosshair OHLCV legend**: hover any candle to see Date, O/H/L/C, % change, and Volume in a fixed overlay
- **SMA overlays**: 50-day (blue) and 200-day (purple) simple moving averages; toggle with `m`
- **20-day volume MA**: yellow line on the volume histogram showing average volume baseline

### Filtering & sorting
- Quote asset (USDT, BTC, ETH, BNB, FDUSD)
- Min 24h volume, min % change
- Sort by volume, % change, price, or trade count
- Exclude leveraged tokens (UP/DOWN/BULL/BEAR)

### Favorites & notes
- Star symbols with `s`, toggle All / Favorites view
- Add per-symbol notes with `n` (persisted to localStorage)
- Export / import favorites + notes as JSON

### Skip tagging
- Mark symbols as "skipped" with `x` to grey them out during the session
- Skipped state is session-scoped (clears on tab close)
- Clear all skips from the settings menu

### Session continuity
- Filter state, current position, and preferences are saved to sessionStorage
- Reopen the tab and resume exactly where you left off
- Filters also persist in the URL for bookmarking/sharing

### Power-user UI
- Dark-only, high-contrast, dense layout
- JetBrains Mono for all data
- Keyboard-first navigation
- Cache status indicator (green = cached, amber = fetching)
- Configurable prefetch depth in settings

## Environment variables (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `BINANCE_BASE_URL` | (auto-detected) | Override the Binance API base URL. The app automatically tries `api.binance.us` then `api.binance.com`. |
