import type { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'

export interface AuthenticatedMember {
  sub: string
  email: string
  role: string
  org: {
    installation_id: string | null
    nation_id: string | null
    tribe_id: string | null
    workforce_team_id: string | null
  }
  scopes: string[]
}

// Augment FastifyRequest so req.member is typed on every route
declare module 'fastify' {
  interface FastifyRequest {
    member?: AuthenticatedMember
  }
}

/**
 * Scope access check.
 *
 * Rules:
 *   1. Exact scope match passes
 *   2. Role scopes are already embedded in the token at issuance time
 *      so there is no role lookup needed here — the scopes array
 *      already reflects everything the member can do
 *
 * Exported so the permissions service can reuse the same logic.
 */
export function hasAccess(memberScopes: string[], required: string): boolean {
  return memberScopes.includes(required)
}

/**
 * Checks whether the member holds a role at or above the required level.
 * Used for role-based guards in addition to scope-based guards.
 *
 * Hierarchy: superadmin > admin > operator > user > custom
 */
const ROLE_HIERARCHY: Record<string, number> = {
  superadmin: 100,
  admin:      75,
  operator:   50,
  user:       25,
  custom:     0,
}

export function hasRole(memberRole: string, requiredRole: string): boolean {
  const memberRank   = ROLE_HIERARCHY[memberRole]   ?? 0
  const requiredRank = ROLE_HIERARCHY[requiredRole] ?? 0
  return memberRank >= requiredRank
}

export function requireAuth(scope?: string) {
  return async function verifyToken(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const authHeader = req.headers.authorization

    if (!authHeader?.startsWith('Bearer ')) {
      req.log.warn(
        { requestId: req.id, method: req.method, url: req.url, code: 'MISSING_TOKEN' },
        'Auth rejected — missing Bearer token'
      )
      return reply.status(401).send({
        error: {
          code:      'MISSING_TOKEN',
          message:   'Authorization header with Bearer token is required',
          requestId: req.id,
          details:   [],
        },
      })
    }

    const token = authHeader.slice(7)

    try {
      const publicKey = req.server.config.JWT_PUBLIC_KEY.replace(/\\n/g, '\n')
      const payload   = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
      }) as AuthenticatedMember

      if (scope && !hasAccess(payload.scopes ?? [], scope)) {
        req.log.warn(
          {
            requestId: req.id,
            method:    req.method,
            url:       req.url,
            memberId:  payload.sub,
            role:      payload.role,
            required:  scope,
            held:      payload.scopes,
            code:      'INSUFFICIENT_SCOPE',
          },
          `Auth rejected — insufficient scope, required: ${scope}`
        )
        return reply.status(403).send({
          error: {
            code:      'INSUFFICIENT_SCOPE',
            message:   `This action requires the "${scope}" scope`,
            requestId: req.id,
            details:   [],
          },
        })
      }

      req.member = payload

    } catch (err: any) {
      const isExpired = err?.name === 'TokenExpiredError'
      const code      = isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'

      req.log.warn(
        {
          requestId: req.id,
          method:    req.method,
          url:       req.url,
          code,
          reason:    err?.message,
        },
        `Auth rejected — ${isExpired ? 'token expired' : 'invalid token'}`
      )
      return reply.status(401).send({
        error: {
          code,
          message: isExpired ? 'Token has expired' : 'Invalid token',
          requestId: req.id,
          details: [],
        },
      })
    }
  }
}

/**
 * Role-based auth guard.
 * Use when you want to gate by role level rather than a specific scope.
 *
 * Example:
 *   preHandler: requireRole('admin')
 *   → passes for admin and superadmin, fails for operator, user, custom
 */
export function requireRole(role: string) {
  return async function verifyRole(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const authHeader = req.headers.authorization

    if (!authHeader?.startsWith('Bearer ')) {
      req.log.warn(
        {
          requestId: req.id,
          method:    req.method,
          url:       req.url,
          code:      'MISSING_TOKEN',
        },
        'Role check rejected — missing Bearer token'
      )
      return reply.status(401).send({
        error: {
          code:      'MISSING_TOKEN',
          message:   'Authorization header with Bearer token is required',
          requestId: req.id,
          details:   [],
        },
      })
    }

    const token = authHeader.slice(7)

    try {
      const publicKey = req.server.config.JWT_PUBLIC_KEY.replace(/\\n/g, '\n')
      const payload   = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
      }) as AuthenticatedMember

      if (!hasRole(payload.role, role)) {
        req.log.warn(
          {
            requestId:    req.id,
            method:       req.method,
            url:          req.url,
            memberId:     payload.sub,
            memberRole:   payload.role,
            requiredRole: role,
            code:         'INSUFFICIENT_ROLE',
          },
          `Role check rejected — member has "${payload.role}", requires "${role}" or above`
        )
        return reply.status(403).send({
          error: {
            code:      'INSUFFICIENT_ROLE',
            message:   `This action requires the "${role}" role or above`,
            requestId: req.id,
            details:   [],
          },
        })
      }

      req.member = payload

    } catch (err: any) {
      const isExpired = err?.name === 'TokenExpiredError'
      const code      = isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'

      req.log.warn(
        {
          requestId: req.id,
          method:    req.method,
          url:       req.url,
          code,
          reason:    err?.message,
        },
        `Role check rejected — ${isExpired ? 'token expired' : 'invalid token'}`
      )
      return reply.status(401).send({
        error: {
          code,
          message:   isExpired ? 'Token has expired' : 'Invalid token',
          requestId: req.id,
          details:   [],
        },
      })
    }
  }
}