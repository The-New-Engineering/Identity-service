import type { FastifyInstance } from 'fastify'
import { AuthService } from '../../../services/auth.service'
import type { OAuthProvider } from '../../../types/auth'

export default async function migrateRoute(app: FastifyInstance) {
  const auth = new AuthService(app)

  // ── Set password (migration path) ─────────────────────────────────
  app.post<{
    Body: { migrationToken: string; password: string }
  }>('/password', {
    schema: {
      body: {
        type: 'object',
        required: ['migrationToken', 'password'],
        properties: {
          migrationToken: { type: 'string' },
          password: { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const tokens = await auth.migrateWithPassword(
      req.body.migrationToken,
      req.body.password
    )
    return reply.status(200).send({ data: tokens })
  })

  // ── Start OAuth migration ──────────────────────────────────────────
  app.get<{
    Params: { provider: OAuthProvider }
    Querystring: { migrationToken: string; state: string }
  }>('/oauth/:provider', {
    schema: {
      params: {
        type: 'object',
        properties: { provider: { type: 'string', enum: ['google', 'apple', 'facebook'] } },
      },
      querystring: {
        type: 'object',
        required: ['migrationToken', 'state'],
        properties: {
          migrationToken: { type: 'string' },
          state: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    // Embed migrationToken in state so it survives the OAuth redirect
    const state = Buffer.from(
      JSON.stringify({ state: req.query.state, migrationToken: req.query.migrationToken })
    ).toString('base64url')

    const url = await auth.getOAuthRedirectUrl(req.params.provider, state, true)
    return reply.redirect(url)
  })

  // ── OAuth callback (migration) ─────────────────────────────────────
  app.get<{
    Params: { provider: OAuthProvider }
    Querystring: { code: string; state: string }
  }>('/oauth/:provider/callback', async (req, reply) => {
    const decoded = JSON.parse(
      Buffer.from(req.query.state, 'base64url').toString()
    ) as { state: string; migrationToken: string }

    const tokens = await auth.handleOAuthCallback(
      req.params.provider,
      req.query.code,
      req.query.state,       // ← original state string (contains migrationToken encoded)
      decoded.migrationToken
    )

    const redirectUrl = new URL(`${app.config.FRONTEND_URL}/auth/callback`)
    redirectUrl.searchParams.set('accessToken', tokens.accessToken)
    redirectUrl.searchParams.set('refreshToken', tokens.refreshToken)

    return reply.redirect(redirectUrl.toString())
  })
}
