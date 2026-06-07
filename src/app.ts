import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import envPlugin    from './config/env'
import errorHandler from './plugins/error-handler'
import dbPlugin     from './plugins/db'
import cachePlugin  from './plugins/cache'
import healthPlugin from './plugins/health'
import v1Router     from './routes/v1'
import internalRoute from './routes/v1/internal'

function buildLogger() {
  const level = process.env.LOG_LEVEL ?? 'info'

  if (process.env.NODE_ENV === 'development') {
    return { level }
  }

  if (process.env.BETTERSTACK_SOURCE_TOKEN) {
    return {
      level,
      transport: {
        targets: [
          {
            target: 'pino/file',
            level,
            options: { destination: 1 },
          },
          {
            target: '@logtail/pino',
            level: 'warn',
            options: {
              sourceToken: process.env.BETTERSTACK_SOURCE_TOKEN,
              endpoint: process.env.BETTERSTACK_INGESTING_HOST ?? 'https://in.logs.betterstack.com',
            },
          },
        ],
      },
    }
  }

  return { level }
}

export async function buildApp() {
  const app = Fastify({
    logger: buildLogger(),
    genReqId: () => crypto.randomUUID(),
  })

  await app.register(envPlugin)
  await app.register(dbPlugin)
  await app.register(cachePlugin)
  await app.register(helmet)
  await app.register(errorHandler)
  await app.register(healthPlugin)
  await app.register(v1Router,      { prefix: '/v1' })
  await app.register(internalRoute, { prefix: '/internal' })

  return app
}