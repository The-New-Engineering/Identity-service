import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import envPlugin from './config/env'
import errorHandler from './plugins/error-handler'
import dbPlugin from './plugins/db'
import cachePlugin from './plugins/cache'
import healthPlugin from './plugins/health'
import v1Router from './routes/v1'
import internalRoute from './routes/v1/internal'

export async function buildApp() {
  function buildLogger() {
  const level = process.env.LOG_LEVEL ?? 'info'

  // Development — no remote logging, use pino-pretty if installed
  if (process.env.NODE_ENV === 'development') {
    return { level }
  }

  // Production — ship WARN and above to Better Stack
  // INFO and below stay local (stdout only)
  if (process.env.BETTERSTACK_SOURCE_TOKEN) {
    return {
      level,
      transport: {
        targets: [
          {
            // Local stdout — all levels
            target: 'pino/file',
            level,
            options: { destination: 1 },   // 1 = stdout
          },
          {
            // Better Stack — WARN and above only
            target: '@logtail/pino',
            level: 'warn',
            options: {
              sourceToken: process.env.BETTERSTACK_SOURCE_TOKEN,
            },
          },
        ],
      },
    }
  }

  // Fallback — stdout only
  return { level }
}

const app = Fastify({
  logger: buildLogger(),
  genReqId: () => crypto.randomUUID(),
})

  // Plugin order matters:
  // 1. Env first — everything depends on config
  // 2. Infrastructure — db + cache must be ready before routes
  // 3. Security + error handler
  // 4. Health — outside versioned prefix
  // 5. Routes last
  await app.register(envPlugin)
  await app.register(dbPlugin)
  await app.register(cachePlugin)
  await app.register(helmet)
  await app.register(errorHandler)
  await app.register(healthPlugin)
  await app.register(v1Router, { prefix: '/v1' })
  await app.register(internalRoute, { prefix: '/internal' })

  return app
}
