import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocketPlugin from "@fastify/websocket";
import { registerRoutes } from "./src/routes";

// ─── Environment ──────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_PROD = NODE_ENV === "production";

// ─── Fastify Instance ─────────────────────────────────────────────────────────

const server = Fastify({
  logger: IS_PROD
    ? true
    : {
        transport: {
          target: "pino-pretty",
          options: {
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
            colorize: true,
          },
        },
      },
  trustProxy: true,
  disableRequestLogging: false,
});

// ─── Plugins ──────────────────────────────────────────────────────────────────

async function registerPlugins(): Promise<void> {
  // Security headers
  await server.register(helmet, {
    contentSecurityPolicy: IS_PROD,
  });

  // CORS
  await server.register(cors, {
    origin: process.env.ALLOWED_ORIGINS?.split(",") ?? "*",
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  });

  // Rate limiting
  await server.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX ?? 100),
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Rate limit reached. Try again in ${context.after}.`,
    }),
  });

  // WebSocket support
  await server.register(websocketPlugin, {
    options: {
      maxPayload: 1048576, // 1 MB
    },
  });
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

server.addHook("onRequest", async (request, _reply) => {
  request.log.info({ url: request.url, method: request.method }, "incoming request");
});

server.addHook("onResponse", async (request, reply) => {
  request.log.info(
    { url: request.url, statusCode: reply.statusCode },
    "request completed"
  );
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

const shutdown = async (signal: string): Promise<void> => {
  server.log.info(`Received ${signal} — shutting down gracefully…`);
  try {
    await server.close();
    server.log.info("Server closed.");
    process.exit(0);
  } catch (err) {
    server.log.error(err, "Error during shutdown");
    process.exit(1);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  try {
    await registerPlugins();
    await registerRoutes(server);

    await server.listen({ port: PORT, host: HOST });
    server.log.info(
      `🚀  Server running on http://${HOST}:${PORT} [${NODE_ENV}]`
    );
  } catch (err) {
    server.log.error(err, "Fatal error during bootstrap");
    process.exit(1);
  }
}

void bootstrap();
