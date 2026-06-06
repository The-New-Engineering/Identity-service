import type { FastifyInstance } from 'fastify'
import { AuthService } from '../../../services/auth.service'

export default async function sessionRoute(app: FastifyInstance) {
  const auth = new AuthService(app)

  // POST /v1/auth/session/refresh
  app.post<{ Body: { refreshToken: string } }>('/refresh', {
    schema: {
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: { refreshToken: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const accessToken = await auth.refresh(req.body.refreshToken)
    return reply.status(200).send({ data: { accessToken } })
  })

  // POST /v1/auth/session/logout
  app.post<{ Body: { refreshToken: string } }>('/logout', {
    schema: {
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: { refreshToken: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    await auth.logout(req.body.refreshToken)
    return reply.status(204).send()
  })
}
