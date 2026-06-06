import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import postgres, { type Sql } from 'postgres'

export default fp(async (app: FastifyInstance) => {
  const sql = postgres(app.config.DATABASE_URL, {
    max: parseInt(app.config.DATABASE_POOL_MAX, 10),
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  })

  // Verify connection at boot — fail fast if DB is unreachable
  try {
    await sql`SELECT 1`
    app.log.info('Database connection established')
  } catch (err) {
    app.log.error({ err }, 'Database connection failed')
    throw err
  }

  app.decorate('db', sql)

  app.addHook('onClose', async () => {
    await sql.end()
    app.log.info('Database connection closed')
  })
})

declare module 'fastify' {
  interface FastifyInstance {
    db: Sql
  }
}
