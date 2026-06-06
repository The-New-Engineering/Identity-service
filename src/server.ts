import { buildApp } from './app'

/**
 * Entrypoint.
 * Boots the app and handles graceful shutdown on SIGTERM / SIGINT.
 * Keep this file thin — no business logic here.
 */
async function main() {
  const app = await buildApp()
  const port = parseInt(app.config.PORT, 10)

  try {
    await app.listen({ port, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err, 'Failed to start server')
    process.exit(1)
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutdown signal received — closing server')
    await app.close()
    app.log.info('Server closed cleanly')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main()
