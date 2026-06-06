import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import Redis from 'ioredis'

export default fp(async (app: FastifyInstance) => {
  const redis = new Redis(app.config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    await redis.ping()
    app.log.info('Redis connection established')
  } catch (err) {
    app.log.error({ err }, 'Redis connection failed')
    throw err
  }

  app.decorate('cache', redis)

  app.addHook('onClose', async () => {
    await redis.quit()
    app.log.info('Redis connection closed')
  })
})

declare module 'fastify' {
  interface FastifyInstance {
    cache: Redis
  }
}
