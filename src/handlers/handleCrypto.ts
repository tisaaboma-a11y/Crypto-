import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import WebSocket from "ws";
import {
  BINANCE_WS_URL,
  BROADCAST_THROTTLE_MS,
  WS_RECONNECT_DELAY_MS,
  WS_MAX_RECONNECT_DELAY_MS,
  WS_RECONNECT_MULTIPLIER,
  type BinanceTradePayload,
  type PriceEntry,
} from "../config/websocket";

// ─── Cache ────────────────────────────────────────────────────────────────────
//  Single source of truth for all crypto prices.
//  Key   : symbol uppercase  (e.g. "BTCUSDT")
//  Value : PriceEntry

const priceCache = new Map<string, PriceEntry>();

// ─── Connected WebSocket Clients ──────────────────────────────────────────────

const clients = new Set<WebSocket>();

// ─── Broadcast Helpers ────────────────────────────────────────────────────────

function broadcastAll(): void {
  if (clients.size === 0) return;

  const payload = JSON.stringify({
    type: "prices",
    data: Object.fromEntries(priceCache),
  });

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// Throttled broadcast — fires at most once per BROADCAST_THROTTLE_MS
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleBroadcast(): void {
  if (broadcastTimer !== null) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastAll();
  }, BROADCAST_THROTTLE_MS);
}

// ─── Binance WebSocket Connection ─────────────────────────────────────────────

let binanceWs: WebSocket | null = null;
let reconnectDelay = WS_RECONNECT_DELAY_MS;

function connectToBinance(log: FastifyInstance["log"]): void {
  log.info({ url: BINANCE_WS_URL }, "Connecting to Binance WebSocket…");

  binanceWs = new WebSocket(BINANCE_WS_URL);

  binanceWs.on("open", () => {
    log.info("Binance WebSocket connected ✅");
    reconnectDelay = WS_RECONNECT_DELAY_MS; // reset backoff on success
  });

  binanceWs.on("message", (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(raw.toString()) as BinanceTradePayload;

      if (!msg?.data?.s || !msg?.data?.p) return;

      const symbol = msg.data.s.toUpperCase();
      const price  = parseFloat(msg.data.p);

      if (isNaN(price)) return;

      priceCache.set(symbol, {
        symbol,
        price,
        updatedAt: msg.data.T,
      });

      scheduleBroadcast();
    } catch {
      // Malformed message — silently ignored
    }
  });

  binanceWs.on("error", (err) => {
    log.error({ err }, "Binance WebSocket error");
  });

  binanceWs.on("close", (code, reason) => {
    log.warn(
      { code, reason: reason.toString() },
      `Binance WebSocket closed — reconnecting in ${reconnectDelay}ms…`
    );

    setTimeout(() => {
      connectToBinance(log);
    }, reconnectDelay);

    // Exponential backoff capped at max
    reconnectDelay = Math.min(
      reconnectDelay * WS_RECONNECT_MULTIPLIER,
      WS_MAX_RECONNECT_DELAY_MS
    );
  });
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

// GET /prices — all cached prices
async function getAllPrices(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (priceCache.size === 0) {
    await reply.status(503).send({
      statusCode: 503,
      error: "Service Unavailable",
      message: "Price cache is empty. Binance stream may not be ready yet.",
    });
    return;
  }

  await reply.send({
    count: priceCache.size,
    data:  Object.fromEntries(priceCache),
  });
}

// GET /prices/:symbol — single crypto
async function getPriceBySymbol(
  request: FastifyRequest<{ Params: { symbol: string } }>,
  reply: FastifyReply
): Promise<void> {
  const symbol = request.params.symbol.toUpperCase();
  const entry  = priceCache.get(symbol);

  if (!entry) {
    await reply.status(404).send({
      statusCode: 404,
      error: "Not Found",
      message: `Symbol "${symbol}" not found in cache.`,
    });
    return;
  }

  await reply.send({ data: entry });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default async function handleCrypto(
  server: FastifyInstance
): Promise<void> {
  // Start Binance stream on plugin load
  connectToBinance(server.log);

  // Graceful cleanup on server close
  server.addHook("onClose", async () => {
    if (broadcastTimer) clearTimeout(broadcastTimer);
    if (binanceWs)      binanceWs.close();
    clients.clear();
    server.log.info("handleCrypto: connections closed.");
  });

  // ── REST routes ─────────────────────────────────────────────────────────────

  server.get("/", getAllPrices);

  server.get<{ Params: { symbol: string } }>("/:symbol", getPriceBySymbol);

  // ── WebSocket route (/stream) ────────────────────────────────────────────────

  server.get(
    "/live",
    { websocket: true },
    (socket) => {
      clients.add(socket);
      server.log.info(`WS client connected (total: ${clients.size})`);

      // Send current cache immediately on connect
      if (priceCache.size > 0) {
        socket.send(
          JSON.stringify({ type: "snapshot", data: Object.fromEntries(priceCache) })
        );
      }

      socket.on("close", () => {
        clients.delete(socket);
        server.log.info(`WS client disconnected (total: ${clients.size})`);
      });

      socket.on("error", (err) => {
        server.log.error({ err }, "WS client error");
        clients.delete(socket);
      });
    }
  );
}
