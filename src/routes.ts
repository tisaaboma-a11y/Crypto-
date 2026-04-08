import type { FastifyInstance } from "fastify";
import handleCrypto from "./handlers/handleCrypto";

// ─── Route Registry ───────────────────────────────────────────────────────────
//
//  Tous les handlers sont enregistrés ici avec leur préfixe.
//  Pour ajouter un domaine : importer le handler et l'enregistrer ci-dessous.
//
// ─────────────────────────────────────────────────────────────────────────────

export async function registerRoutes(server: FastifyInstance): Promise<void> {

  // ── Health ──────────────────────────────────────────────────────────────────
  server.get(
    "/health",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              status:    { type: "string" },
              uptime:    { type: "number" },
              timestamp: { type: "string" },
            },
          },
        },
      },
    },
    async () => ({
      status:    "ok",
      uptime:    process.uptime(),
      timestamp: new Date().toISOString(),
    })
  );

  // ── Crypto ──────────────────────────────────────────────────────────────────
  //  GET  /prices          → tous les prix en cache
  //  GET  /prices/:symbol  → prix d'un seul symbole
  //  WS   /prices/live     → stream temps réel (WebSocket)
  await server.register(handleCrypto, { prefix: "/prices" });

  // ── 404 ─────────────────────────────────────────────────────────────────────
  server.setNotFoundHandler(async (_request, reply) => {
    await reply.status(404).send({
      statusCode: 404,
      error:      "Not Found",
      message:    "The requested route does not exist.",
    });
  });

  // ── Global error handler ────────────────────────────────────────────────────
  server.setErrorHandler(async (error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode ?? 500;
    await reply.status(statusCode).send({
      statusCode,
      error:   error.name    ?? "Internal Server Error",
      message: error.message ?? "An unexpected error occurred.",
    });
  });
}
