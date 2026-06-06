import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'

export default fp(async (app: FastifyInstance) => {
  app.get('/health', async (_req, reply) => {
    const checks = await Promise.allSettled([
      app.db`SELECT 1`.then(() => 'ok').catch(() => 'unreachable'),
      app.cache.ping().then(() => 'ok').catch(() => 'unreachable'),
    ])

    const [db, cache] = checks.map((r) =>
      r.status === 'fulfilled' ? r.value : 'unreachable'
    )

    const healthy = db === 'ok' && cache === 'ok'

    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      service: app.config.SERVICE_NAME,
      environment: app.config.NODE_ENV,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database: db, cache },
    })
  })
})
