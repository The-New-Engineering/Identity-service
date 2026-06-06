import type { FastifyInstance } from 'fastify'
import { requireAuth, requireRole } from '../../middleware/verify-token'
import { PermissionsService } from '../../services/permissions.service'

export default async function permissionsRoute(app: FastifyInstance) {
  const svc = new PermissionsService(app)

  // ── Scope definitions ──────────────────────────────────────────────

  /**
   * GET /v1/permissions/scopes
   * List all scopes — admin and above.
   * Pass ?includeArchived=true to include archived scopes.
   */
  app.get<{ Querystring: { includeArchived?: string } }>('/scopes', {
    preHandler: requireRole('admin'),
  }, async (req, reply) => {
    const includeArchived = req.query.includeArchived === 'true'
    const scopes = await svc.listScopes(includeArchived)
    return reply.send({ data: scopes })
  })

  /**
   * POST /v1/permissions/scopes
   * Create a new scope — superadmin only.
   */
  app.post<{
    Body: { name: string; description?: string; isGlobal?: boolean }
  }>('/scopes', {
    preHandler: requireRole('superadmin'),
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:        { type: 'string', minLength: 1 },
          description: { type: 'string' },
          isGlobal:    { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const scope = await svc.createScope(req.body)
    return reply.status(201).send({ data: scope })
  })

  /**
   * PATCH /v1/permissions/scopes/:scopeId/archive
   * Archive a scope — superadmin only.
   * Archived scopes cannot be granted to new members.
   */
  app.patch<{ Params: { scopeId: string } }>(
    '/scopes/:scopeId/archive', {
      preHandler: requireRole('superadmin'),
    }, async (req, reply) => {
      const scope = await svc.archiveScope(req.params.scopeId)
      if (!scope) {
        return reply.status(404).send({
          error: {
            code: 'SCOPE_NOT_FOUND',
            message: 'Scope not found or already archived',
            requestId: req.id,
            details: [],
          },
        })
      }
      return reply.send({ data: scope })
    }
  )

  /**
   * PATCH /v1/permissions/scopes/:scopeId/restore
   * Restore an archived scope — superadmin only.
   */
  app.patch<{ Params: { scopeId: string } }>(
    '/scopes/:scopeId/restore', {
      preHandler: requireRole('superadmin'),
    }, async (req, reply) => {
      const scope = await svc.restoreScope(req.params.scopeId)
      if (!scope) {
        return reply.status(404).send({
          error: {
            code: 'SCOPE_NOT_FOUND',
            message: 'Scope not found or not archived',
            requestId: req.id,
            details: [],
          },
        })
      }
      return reply.send({ data: scope })
    }
  )

  // ── Role management ────────────────────────────────────────────────

  /**
   * GET /v1/permissions/roles
   * List all roles — admin and above.
   */
  app.get('/roles', {
    preHandler: requireRole('admin'),
  }, async (_req, reply) => {
    const roles = await svc.listRoles()
    return reply.send({ data: roles })
  })

  /**
   * GET /v1/permissions/roles/:roleId/scopes
   * List scopes belonging to a role — admin and above.
   */
  app.get<{ Params: { roleId: string } }>('/roles/:roleId/scopes', {
    preHandler: requireRole('admin'),
  }, async (req, reply) => {
    const scopes = await svc.getRoleScopes(req.params.roleId)
    return reply.send({ data: scopes })
  })

  /**
   * POST /v1/permissions/members/:memberId/role
   * Assign a role to a member.
   * superadmin — can assign any role except custom
   * admin      — can assign operator and user only
   */
  app.post<{
    Params: { memberId: string }
    Body: { role: string }
  }>('/members/:memberId/role', {
    preHandler: requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        required: ['role'],
        properties: {
          role: {
            type: 'string',
            enum: ['superadmin', 'admin', 'operator', 'user'],
          },
        },
      },
    },
  }, async (req, reply) => {
    await svc.assignRole({
      targetMemberId: req.params.memberId,
      roleName:       req.body.role,
      callerRole:     req.member!.role,
    })
    return reply.status(204).send()
  })

  // ── Member scope grants ────────────────────────────────────────────

  /**
   * GET /v1/permissions/members/:memberId/scopes
   * View a member's individual scope grants — admin and above.
   */
  app.get<{ Params: { memberId: string } }>(
    '/members/:memberId/scopes', {
      preHandler: requireRole('admin'),
    }, async (req, reply) => {
      const scopes = await svc.getMemberScopes(req.params.memberId)
      return reply.send({ data: scopes })
    }
  )

  /**
   * POST /v1/permissions/members/:memberId/scopes
   * Grant additional scopes to a member.
   * superadmin — can grant any non-archived scope
   * admin      — can only grant scopes in ADMIN_GRANTABLE_SCOPES
   *
   * If any granted scope falls outside the member's current role,
   * the member transitions to the custom role automatically.
   */
  app.post<{
    Params: { memberId: string }
    Body: { scopes: string[] }
  }>('/members/:memberId/scopes', {
    preHandler: requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        required: ['scopes'],
        properties: {
          scopes: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
        },
      },
    },
  }, async (req, reply) => {
    await svc.grantScopes({
      targetMemberId: req.params.memberId,
      scopeNames:     req.body.scopes,
      grantedById:    req.member!.sub,
      callerRole:     req.member!.role,
    })
    return reply.status(204).send()
  })

  /**
   * DELETE /v1/permissions/members/:memberId/scopes/:scopeId
   * Revoke a scope from a member — superadmin only.
   * Refresh tokens are revoked so the change takes effect
   * within the 15-minute access token window.
   */
  app.delete<{
    Params: { memberId: string; scopeId: string }
  }>('/members/:memberId/scopes/:scopeId', {
    preHandler: requireRole('superadmin'),
  }, async (req, reply) => {
    await svc.revokeScope({
      targetMemberId: req.params.memberId,
      scopeId:        req.params.scopeId,
      callerRole:     req.member!.role,
    })
    return reply.status(204).send()
  })
}