import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../middleware/verify-token'
import { MemberService } from '../../services/member.service'

export default async function membersRoute(app: FastifyInstance) {
  const members = new MemberService(app)

  // ── List members ───────────────────────────────────────────────────────────

  /**
   * GET /v1/members
   * List all members with optional filters.
   * Supports pagination via limit and offset.
   * Requires members.profile.read scope.
   */
  app.get<{
    Querystring: {
      installationId?: string
      nationId?: string
      tribeId?: string
      workforceTeamId?: string
      status?: string
      limit?: number
      offset?: number
    }
  }>('/', {
    preHandler: requireAuth('members.profile.read'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          installationId:  { type: 'string' },
          nationId:        { type: 'string' },
          tribeId:         { type: 'string' },
          workforceTeamId: { type: 'string' },
          status:          { type: 'string', enum: ['active', 'inactive', 'suspended'] },
          limit:           { type: 'number', minimum: 1, maximum: 100, default: 20 },
          offset:          { type: 'number', minimum: 0, default: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const result = await members.listMembers(req.query)
    return reply.send({
      data:  result.members,
      meta: {
        total:  result.total,
        limit:  req.query.limit  ?? 20,
        offset: req.query.offset ?? 0,
      },
    })
  })

  // ── Get single member ──────────────────────────────────────────────────────

  /**
   * GET /v1/members/:id
   * Get a single member by UUID including full placement context.
   * Requires members.profile.read scope.
   */
  app.get<{ Params: { id: string } }>('/:id', {
    preHandler: requireAuth('members.profile.read'),
  }, async (req, reply) => {
    const member = await members.findById(req.params.id)

    if (!member) {
      return reply.status(404).send({
        error: {
          code:      'MEMBER_NOT_FOUND',
          message:   'Member not found',
          requestId: req.id,
          details:   [],
        },
      })
    }

    return reply.send({ data: member })
  })

  // ── Update placement ───────────────────────────────────────────────────────

  /**
   * PATCH /v1/members/:id/placement
   * Update a member's organisational placement.
   * Requires members.placement.update scope — admin and above only.
   *
   * All fields are optional — only provided fields are updated.
   * placement_complete is automatically set based on whether
   * installation_id is set after the update.
   */
  app.patch<{
    Params: { id: string }
    Body: {
      installationId?: string
      nationId?: string
      tribeId?: string
      workforceTeamId?: string
    }
  }>('/:id/placement', {
    preHandler: requireAuth('members.placement.update'),
    schema: {
      body: {
        type: 'object',
        properties: {
          installationId:  { type: 'string' },
          nationId:        { type: 'string' },
          tribeId:         { type: 'string' },
          workforceTeamId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    // Validate installation exists if being updated
    if (req.body.installationId) {
      const rows = await app.db.unsafe(
        `SELECT id FROM installations
         WHERE id = $1 AND is_active = TRUE`,
        [req.body.installationId]
      )
      if (!rows[0]) {
        return reply.status(400).send({
          error: {
            code:      'INVALID_INSTALLATION',
            message:   'Installation not found or inactive',
            requestId: req.id,
            details:   [],
          },
        })
      }
    }

    const member = await members.updatePlacement(req.params.id, {
      installationId:  req.body.installationId,
      nationId:        req.body.nationId,
      tribeId:         req.body.tribeId,
      workforceTeamId: req.body.workforceTeamId,
    })

    if (!member) {
      return reply.status(404).send({
        error: {
          code:      'MEMBER_NOT_FOUND',
          message:   'Member not found',
          requestId: req.id,
          details:   [],
        },
      })
    }

    // Revoke refresh tokens — placement change should reflect in next token
    await app.db.unsafe(
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE member_id = $1 AND revoked_at IS NULL`,
      [req.params.id]
    )

    return reply.send({ data: member })
  })

  // ── Interest groups ────────────────────────────────────────────────────────

  /**
   * GET /v1/members/:id/interest-groups
   * List a member's interest group memberships.
   * Requires members.profile.read scope.
   */
  app.get<{ Params: { id: string } }>(
    '/:id/interest-groups', {
      preHandler: requireAuth('members.profile.read'),
    }, async (req, reply) => {
      const member = await members.findById(req.params.id)
      if (!member) {
        return reply.status(404).send({
          error: {
            code:      'MEMBER_NOT_FOUND',
            message:   'Member not found',
            requestId: req.id,
            details:   [],
          },
        })
      }

      const groups = await members.getMemberInterestGroups(req.params.id)
      return reply.send({ data: groups })
    }
  )

  /**
   * POST /v1/members/:id/interest-groups
   * Assign a member to one or more interest groups.
   * Requires members.groups.assign scope — admin and above only.
   */
  app.post<{
    Params: { id: string }
    Body: { groupIds: string[] }
  }>('/:id/interest-groups', {
    preHandler: requireAuth('members.groups.assign'),
    schema: {
      body: {
        type: 'object',
        required: ['groupIds'],
        properties: {
          groupIds: {
            type: 'array',
            items:    { type: 'string' },
            minItems: 1,
          },
        },
      },
    },
  }, async (req, reply) => {
    const member = await members.findById(req.params.id)
    if (!member) {
      return reply.status(404).send({
        error: {
          code:      'MEMBER_NOT_FOUND',
          message:   'Member not found',
          requestId: req.id,
          details:   [],
        },
      })
    }

    // Validate all group IDs exist and are active
    const rows = await app.db.unsafe(
      `SELECT id FROM interest_groups
       WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
      [req.body.groupIds]
    )

    const foundIds = (rows as any[]).map((r) => r.id as string)
    const missing  = req.body.groupIds.filter((id) => !foundIds.includes(id))
    if (missing.length > 0) {
      return reply.status(400).send({
        error: {
          code:      'INVALID_GROUP',
          message:   'One or more interest groups not found or inactive',
          requestId: req.id,
          details:   missing.map((id) => ({ field: 'groupIds', message: `Group ${id} not found` })),
        },
      })
    }

    await members.assignInterestGroups(req.params.id, req.body.groupIds)
    return reply.status(204).send()
  })

  /**
   * DELETE /v1/members/:id/interest-groups/:groupId
   * Remove a member from an interest group.
   * Requires members.groups.assign scope — admin and above only.
   */
  app.delete<{
    Params: { id: string; groupId: string }
  }>('/:id/interest-groups/:groupId', {
    preHandler: requireAuth('members.groups.assign'),
  }, async (req, reply) => {
    await members.removeInterestGroup(req.params.id, req.params.groupId)
    return reply.status(204).send()
  })

  // ── Affinity groups ────────────────────────────────────────────────────────

  /**
   * GET /v1/members/:id/affinity-groups
   * List a member's affinity group memberships.
   * Requires members.profile.read scope.
   */
  app.get<{ Params: { id: string } }>(
    '/:id/affinity-groups', {
      preHandler: requireAuth('members.profile.read'),
    }, async (req, reply) => {
      const member = await members.findById(req.params.id)
      if (!member) {
        return reply.status(404).send({
          error: {
            code:      'MEMBER_NOT_FOUND',
            message:   'Member not found',
            requestId: req.id,
            details:   [],
          },
        })
      }

      const groups = await members.getMemberAffinityGroups(req.params.id)
      return reply.send({ data: groups })
    }
  )

  /**
   * POST /v1/members/:id/affinity-groups
   * Assign a member to one or more affinity groups.
   * Requires members.groups.assign scope — admin and above only.
   */
  app.post<{
    Params: { id: string }
    Body: { groupIds: string[] }
  }>('/:id/affinity-groups', {
    preHandler: requireAuth('members.groups.assign'),
    schema: {
      body: {
        type: 'object',
        required: ['groupIds'],
        properties: {
          groupIds: {
            type: 'array',
            items:    { type: 'string' },
            minItems: 1,
          },
        },
      },
    },
  }, async (req, reply) => {
    const member = await members.findById(req.params.id)
    if (!member) {
      return reply.status(404).send({
        error: {
          code:      'MEMBER_NOT_FOUND',
          message:   'Member not found',
          requestId: req.id,
          details:   [],
        },
      })
    }

    // Validate all group IDs exist and are active
    const rows = await app.db.unsafe(
      `SELECT id FROM affinity_groups
       WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
      [req.body.groupIds]
    )

    const foundIds = (rows as any[]).map((r) => r.id as string)
    const missing  = req.body.groupIds.filter((id) => !foundIds.includes(id))
    if (missing.length > 0) {
      return reply.status(400).send({
        error: {
          code:      'INVALID_GROUP',
          message:   'One or more affinity groups not found or inactive',
          requestId: req.id,
          details:   missing.map((id) => ({ field: 'groupIds', message: `Group ${id} not found` })),
        },
      })
    }

    await members.assignAffinityGroups(req.params.id, req.body.groupIds)
    return reply.status(204).send()
  })

  /**
   * DELETE /v1/members/:id/affinity-groups/:groupId
   * Remove a member from an affinity group.
   * Requires members.groups.assign scope — admin and above only.
   */
  app.delete<{
    Params: { id: string; groupId: string }
  }>('/:id/affinity-groups/:groupId', {
    preHandler: requireAuth('members.groups.assign'),
  }, async (req, reply) => {
    await members.removeAffinityGroup(req.params.id, req.params.groupId)
    return reply.status(204).send()
  })
}