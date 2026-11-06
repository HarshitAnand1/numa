import type { FastifyInstance } from "fastify";

/** Minimal allowlist CORS (no extra dependency). Reflects the Origin only if it is allowed; "*" allows any. */
export function registerCors(app: FastifyInstance, origins: string[]) {
  const any = origins.includes("*");
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && (any || origins.includes(origin))) {
      reply.header("access-control-allow-origin", any ? "*" : origin);
      reply.header("vary", "Origin");
      reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
      reply.header("access-control-allow-headers", "content-type");
      reply.header("access-control-max-age", "600");
    }
    if (req.method === "OPTIONS") return reply.code(204).send();
  });
}
