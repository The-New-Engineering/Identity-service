import type { FastifyInstance } from 'fastify'
import crypto from 'crypto'

export default async function jwksRoute(app: FastifyInstance) {
  /**
   * JWKS endpoint — consumed by other services to verify JWTs locally.
   * They fetch this once, cache it, and verify tokens without calling
   * the identity service on every request.
   */
  app.get('/', async (_req, reply) => {
    const publicKeyPem = app.config.JWT_PUBLIC_KEY.replace(/\\n/g, '\n')

    const key = crypto.createPublicKey(publicKeyPem)
    const jwk = key.export({ format: 'jwk' })

    return reply.send({
      keys: [{
        ...jwk,
        use: 'sig',
        alg: 'RS256',
        kid: 'identity-service-key-1',
      }],
    })
  })
}
