import type { FastifyInstance } from 'fastify'
import { AuthService } from '../../../services/auth.service'
import type { OAuthProvider } from '../../../types/auth'

export default async function oauthRoute(app: FastifyInstance) {
  const auth = new AuthService(app)

  // ── Initiate OAuth ─────────────────────────────────────────────────
  app.get<{
    Params: { provider: OAuthProvider }
    Querystring: { state: string; installationCode?: string }
  }>('/:provider', {
    schema: {
      params: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['google', 'apple', 'facebook'] },
        },
      },
      querystring: {
        type: 'object',
        required: ['state'],
        properties: {
          state:            { type: 'string' },
          installationCode: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const url = await auth.getOAuthRedirectUrl(
      req.params.provider,
      req.query.state,
      false,
      req.query.installationCode    // ← pass through to embed in state
    )
    return reply.redirect(url)
  })

  // ── OAuth callback ─────────────────────────────────────────────────
  app.get<{
    Params: { provider: OAuthProvider }
    Querystring: { code: string; state: string }
  }>('/:provider/callback', async (req, reply) => {
    const tokens = await auth.handleOAuthCallback(
      req.params.provider,
      req.query.code,
      req.query.state    // ← pass state so GoogleProvider can retrieve codeVerifier
    )

    const redirectUrl = new URL(`${app.config.FRONTEND_URL}/auth/callback`)
    redirectUrl.searchParams.set('accessToken', tokens.accessToken)
    redirectUrl.searchParams.set('refreshToken', tokens.refreshToken)

    return reply.redirect(redirectUrl.toString())
  })
}
