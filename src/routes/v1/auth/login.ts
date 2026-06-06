import type { FastifyInstance } from 'fastify'
import { AuthService } from '../../../services/auth.service'

export default async function loginRoute(app: FastifyInstance) {
  const auth = new AuthService(app)

  app.post<{ Body: { email: string; password: string } }>('/', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const result = await auth.login(req.body.email, req.body.password)

    // Migration required — distinct status, not an error
    if ('status' in result && result.status === 'migration_required') {
      return reply.status(200).send(result)
    }

    return reply.status(200).send({ data: result })
  })
}
