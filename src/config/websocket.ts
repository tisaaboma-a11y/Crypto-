import "dotenv/config";

// ─── Crypto Symbols ───────────────────────────────────────────────────────────

export const CRYPTO_SYMBOLS = (
  process.env.BINANCE_STREAMS ??
  "btcusdt@trade,ethusdt@trade,bnbusdt@trade,solusdt@trade,xrpusdt@trade,adausdt@trade,dogeusdt@trade,maticusdt@trade"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// ─── Binance WebSocket URL ────────────────────────────────────────────────────

const BASE_URL = process.env.BINANCE_WS_URL ?? "wss://stream.binance.com:9443/stream";
export const BINANCE_WS_URL = `${BASE_URL}?streams=${CRYPTO_SYMBOLS.join("/")}`;

// ─── Reconnection ─────────────────────────────────────────────────────────────

export const WS_RECONNECT_DELAY_MS  = 3_000;   // initial retry delay
export const WS_MAX_RECONNECT_DELAY_MS = 30_000; // cap for exponential backoff
export const WS_RECONNECT_MULTIPLIER = 2;        // backoff multiplier

// ─── Throttle ─────────────────────────────────────────────────────────────────

// Minimum interval (ms) between broadcast pushes to WS clients
export const BROADCAST_THROTTLE_MS = Number(process.env.BROADCAST_THROTTLE_MS ?? 1_000);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BinanceTradePayload {
  stream: string;   // e.g. "btcusdt@trade"
  data: {
    s: string;      // symbol  — "BTCUSDT"
    p: string;      // price   — "67000.00"
    T: number;      // trade time (ms timestamp)
  };
}

export interface PriceEntry {
  symbol:    string;
  price:     number;
  updatedAt: number; // ms timestamp
}
