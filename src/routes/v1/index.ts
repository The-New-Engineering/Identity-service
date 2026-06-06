import type { FastifyInstance } from 'fastify'
import registerRoute    from './auth/register'
import loginRoute       from './auth/login'
import migrateRoute     from './auth/migrate'
import oauthRoute       from './auth/oauth'
import passwordRoute    from './auth/password'
import sessionRoute     from './auth/session'
import jwksRoute        from './jwks'
import organisationsRoute from './organisation'
import permissionsRoute   from './permissions'
import membersRoute       from './member'
import groupsRoute        from './groups'

export default async function v1Router(app: FastifyInstance) {

  // ── Auth ──────────────────────────────────────────────────────────
  app.register(registerRoute, { prefix: '/auth/register' })
  app.register(loginRoute,    { prefix: '/auth/login' })
  app.register(migrateRoute,  { prefix: '/auth/migrate' })
  app.register(oauthRoute,    { prefix: '/auth/oauth' })
  app.register(passwordRoute, { prefix: '/auth/password' })
  app.register(sessionRoute,  { prefix: '/auth/session' })

  // ── JWKS — public key for consuming services ──────────────────────
  app.register(jwksRoute, { prefix: '/.well-known/jwks.json' })

  // ── Organisation hierarchy ────────────────────────────────────────
  app.register(organisationsRoute, { prefix: '/org' })

  // ── Members ───────────────────────────────────────────────────────
  app.register(membersRoute, { prefix: '/members' })

  // ── Groups ────────────────────────────────────────────────────────
  app.register(groupsRoute, { prefix: '/groups' })

  // ── Permissions and roles ─────────────────────────────────────────
  app.register(permissionsRoute, { prefix: '/permissions' })
}