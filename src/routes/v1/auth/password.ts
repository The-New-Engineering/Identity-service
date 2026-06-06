import type { FastifyInstance } from 'fastify'
import { AuthService } from '../../../services/auth.service'

export default async function passwordRoute(app: FastifyInstance) {
  const auth = new AuthService(app)

  // POST /v1/auth/password/forgot
  app.post<{ Body: { email: string } }>('/forgot', {
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
      },
    },
  }, async (req, reply) => {
    // Always return 200 — never reveal whether the email exists
    await auth.requestPasswordReset(req.body.email)
    return reply.status(200).send({
      message: 'If that email is registered, a reset link has been sent.',
    })
  })

  // POST /v1/auth/password/reset
  app.post<{ Body: { token: string; password: string } }>('/reset', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string' },
          password: { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    await auth.resetPassword(req.body.token, req.body.password)
    return reply.status(204).send()
  })
}
