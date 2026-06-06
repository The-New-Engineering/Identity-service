import type { FastifyInstance } from 'fastify'
import { AuthService } from '../../../services/auth.service'

export default async function registerRoute(app: FastifyInstance) {
  const auth = new AuthService(app)

  /**
   * POST /v1/auth/register
   *
   * Registers a new member. installation_id is required.
   * The frontend should resolve the installation code to a UUID
   * using GET /v1/auth/register/installation?code=LAG-001 before submitting.
   */
  app.post<{
    Body: {
      email: string
      password: string
      firstName: string
      lastName: string
      installationId: string
      nationId?: string
      tribeId?: string
      workforceTeamId?: string
      phone?: string
      address?: string
      dateOfBirth?: string
    }
  }>('/', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password', 'firstName', 'lastName', 'installationId'],
        properties: {
          email:           { type: 'string', format: 'email' },
          password:        { type: 'string', minLength: 8 },
          firstName:       { type: 'string', minLength: 1 },
          lastName:        { type: 'string', minLength: 1 },
          installationId:  { type: 'string', minLength: 1 },
          nationId:        { type: 'string' },
          tribeId:         { type: 'string' },
          workforceTeamId: { type: 'string' },
          phone:           { type: 'string' },
          address:         { type: 'string' },
          dateOfBirth:     { type: 'string', format: 'date' },
        },
      },
    },
  }, async (req, reply) => {
    const tokens = await auth.register(req.body)
    return reply.status(201).send({ data: tokens })
  })

  /**
   * GET /v1/auth/register/installation?code=LAG-001
   *
   * Resolves an installation code to its UUID and name.
   * Called by the frontend before rendering the registration form.
   * Returns 404 if the code is invalid or the installation is inactive.
   *
   * This is a public endpoint — no auth required.
   * The frontend uses this to validate the registration link
   * and display the branch name to the user.
   */
  app.get<{ Querystring: { code: string } }>(
    '/installation', {
      schema: {
        querystring: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', minLength: 1 },
          },
        },
      },
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `SELECT id, name, code, timezone
         FROM installations
         WHERE code = $1 AND is_active = TRUE`,
        [req.query.code]
      )

      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code: 'INSTALLATION_NOT_FOUND',
            message: 'This registration link is invalid or has expired. Please contact your branch administrator.',
            requestId: req.id,
            details: [],
          },
        })
      }

      return reply.send({ data: rows[0] })
    }
  )
}