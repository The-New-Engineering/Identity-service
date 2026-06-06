import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../middleware/verify-token'

export default async function groupsRoute(app: FastifyInstance) {

  // ── Interest Groups ────────────────────────────────────────────────────────

  /**
   * POST /v1/groups/interest
   * Create a new interest group.
   * Requires groups.interest.create scope — admin and above only.
   */
  app.post<{
    Body: { name: string; description?: string }
  }>('/interest', {
    preHandler: requireAuth('groups.interest.create'),
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:        { type: 'string', minLength: 1 },
          description: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const rows = await app.db.unsafe(
      `INSERT INTO interest_groups (name, description)
       VALUES ($1, $2)
       RETURNING *`,
      [req.body.name, req.body.description ?? null]
    )
    return reply.status(201).send({ data: rows[0] })
  })

  /**
   * GET /v1/groups/interest
   * List all interest groups.
   * Pass ?includeInactive=true to include inactive groups.
   * Requires groups.interest.read scope.
   */
  app.get<{
    Querystring: { includeInactive?: string }
  }>('/interest', {
    preHandler: requireAuth('groups.interest.read'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          includeInactive: { type: 'string', enum: ['true', 'false'] },
        },
      },
    },
  }, async (req, reply) => {
    const includeInactive = req.query.includeInactive === 'true'
    const rows = await app.db.unsafe(
      `SELECT
         ig.*,
         COUNT(mig.member_id)::int AS member_count
       FROM interest_groups ig
       LEFT JOIN member_interest_groups mig ON mig.interest_group_id = ig.id
       WHERE ($1 = TRUE OR ig.is_active = TRUE)
       GROUP BY ig.id
       ORDER BY ig.name ASC`,
      [includeInactive]
    )
    return reply.send({ data: rows })
  })

  /**
   * GET /v1/groups/interest/:id
   * Get a single interest group by ID including member count.
   * Requires groups.interest.read scope.
   */
  app.get<{ Params: { id: string } }>(
    '/interest/:id', {
      preHandler: requireAuth('groups.interest.read'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `SELECT
           ig.*,
           COUNT(mig.member_id)::int AS member_count
         FROM interest_groups ig
         LEFT JOIN member_interest_groups mig ON mig.interest_group_id = ig.id
         WHERE ig.id = $1
         GROUP BY ig.id`,
        [req.params.id]
      )

      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'GROUP_NOT_FOUND',
            message:   'Interest group not found',
            requestId: req.id,
            details:   [],
          },
        })
      }

      return reply.send({ data: rows[0] })
    }
  )

  /**
   * PATCH /v1/groups/interest/:id
   * Update an interest group name or description.
   * Requires groups.interest.create scope — admin and above only.
   */
  app.patch<{
    Params: { id: string }
    Body: { name?: string; description?: string; isActive?: boolean }
  }>('/interest/:id', {
    preHandler: requireAuth('groups.interest.create'),
    schema: {
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string', minLength: 1 },
          description: { type: 'string' },
          isActive:    { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const updates: string[] = []
    const values: any[]     = []
    let   paramIndex        = 1

    if (req.body.name        !== undefined) { updates.push(`name = $${paramIndex++}`);        values.push(req.body.name) }
    if (req.body.description !== undefined) { updates.push(`description = $${paramIndex++}`); values.push(req.body.description) }
    if (req.body.isActive    !== undefined) { updates.push(`is_active = $${paramIndex++}`);   values.push(req.body.isActive) }

    if (updates.length === 0) {
      return reply.status(400).send({
        error: {
          code:      'NO_FIELDS_PROVIDED',
          message:   'At least one field must be provided',
          requestId: req.id,
          details:   [],
        },
      })
    }

    values.push(req.params.id)
    const rows = await app.db.unsafe(
      `UPDATE interest_groups
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    )

    if (!rows[0]) {
      return reply.status(404).send({
        error: {
          code:      'GROUP_NOT_FOUND',
          message:   'Interest group not found',
          requestId: req.id,
          details:   [],
        },
      })
    }

    return reply.send({ data: rows[0] })
  })

  /**
   * DELETE /v1/groups/interest/:id
   * Soft delete — sets is_active to FALSE.
   * Members already in the group retain their membership record
   * but the group no longer appears in active group lists.
   * Requires groups.interest.delete scope — superadmin only.
   */
  app.delete<{ Params: { id: string } }>(
    '/interest/:id', {
      preHandler: requireAuth('groups.interest.delete'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `UPDATE interest_groups
         SET is_active = FALSE
         WHERE id = $1 AND is_active = TRUE
         RETURNING id`,
        [req.params.id]
      )

      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'GROUP_NOT_FOUND',
            message:   'Interest group not found or already inactive',
            requestId: req.id,
            details:   [],
          },
        })
      }

      return reply.status(204).send()
    }
  )

  // ── Affinity Groups ────────────────────────────────────────────────────────

  /**
   * POST /v1/groups/affinity
   * Create a new affinity group.
   * Requires groups.affinity.create scope — admin and above only.
   */
  app.post<{
    Body: { name: string; description?: string }
  }>('/affinity', {
    preHandler: requireAuth('groups.affinity.create'),
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:        { type: 'string', minLength: 1 },
          description: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const rows = await app.db.unsafe(
      `INSERT INTO affinity_groups (name, description)
       VALUES ($1, $2)
       RETURNING *`,
      [req.body.name, req.body.description ?? null]
    )
    return reply.status(201).send({ data: rows[0] })
  })

  /**
   * GET /v1/groups/affinity
   * List all affinity groups.
   * Pass ?includeInactive=true to include inactive groups.
   * Requires groups.affinity.read scope.
   */
  app.get<{
    Querystring: { includeInactive?: string }
  }>('/affinity', {
    preHandler: requireAuth('groups.affinity.read'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          includeInactive: { type: 'string', enum: ['true', 'false'] },
        },
      },
    },
  }, async (req, reply) => {
    const includeInactive = req.query.includeInactive === 'true'
    const rows = await app.db.unsafe(
      `SELECT
         ag.*,
         COUNT(mag.member_id)::int AS member_count
       FROM affinity_groups ag
       LEFT JOIN member_affinity_groups mag ON mag.affinity_group_id = ag.id
       WHERE ($1 = TRUE OR ag.is_active = TRUE)
       GROUP BY ag.id
       ORDER BY ag.name ASC`,
      [includeInactive]
    )
    return reply.send({ data: rows })
  })

  /**
   * GET /v1/groups/affinity/:id
   * Get a single affinity group by ID including member count.
   * Requires groups.affinity.read scope.
   */
  app.get<{ Params: { id: string } }>(
    '/affinity/:id', {
      preHandler: requireAuth('groups.affinity.read'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `SELECT
           ag.*,
           COUNT(mag.member_id)::int AS member_count
         FROM affinity_groups ag
         LEFT JOIN member_affinity_groups mag ON mag.affinity_group_id = ag.id
         WHERE ag.id = $1
         GROUP BY ag.id`,
        [req.params.id]
      )

      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'GROUP_NOT_FOUND',
            message:   'Affinity group not found',
            requestId: req.id,
            details:   [],
          },
        })
      }

      return reply.send({ data: rows[0] })
    }
  )

  /**
   * PATCH /v1/groups/affinity/:id
   * Update an affinity group name or description.
   * Requires groups.affinity.create scope — admin and above only.
   */
  app.patch<{
    Params: { id: string }
    Body: { name?: string; description?: string; isActive?: boolean }
  }>('/affinity/:id', {
    preHandler: requireAuth('groups.affinity.create'),
    schema: {
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string', minLength: 1 },
          description: { type: 'string' },
          isActive:    { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const updates: string[] = []
    const values: any[]     = []
    let   paramIndex        = 1

    if (req.body.name        !== undefined) { updates.push(`name = $${paramIndex++}`);        values.push(req.body.name) }
    if (req.body.description !== undefined) { updates.push(`description = $${paramIndex++}`); values.push(req.body.description) }
    if (req.body.isActive    !== undefined) { updates.push(`is_active = $${paramIndex++}`);   values.push(req.body.isActive) }

    if (updates.length === 0) {
      return reply.status(400).send({
        error: {
          code:      'NO_FIELDS_PROVIDED',
          message:   'At least one field must be provided',
          requestId: req.id,
          details:   [],
        },
      })
    }

    values.push(req.params.id)
    const rows = await app.db.unsafe(
      `UPDATE affinity_groups
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    )

    if (!rows[0]) {
      return reply.status(404).send({
        error: {
          code:      'GROUP_NOT_FOUND',
          message:   'Affinity group not found',
          requestId: req.id,
          details:   [],
        },
      })
    }

    return reply.send({ data: rows[0] })
  })

  /**
   * DELETE /v1/groups/affinity/:id
   * Soft delete — sets is_active to FALSE.
   * Requires groups.affinity.delete scope — superadmin only.
   */
  app.delete<{ Params: { id: string } }>(
    '/affinity/:id', {
      preHandler: requireAuth('groups.affinity.delete'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `UPDATE affinity_groups
         SET is_active = FALSE
         WHERE id = $1 AND is_active = TRUE
         RETURNING id`,
        [req.params.id]
      )

      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'GROUP_NOT_FOUND',
            message:   'Affinity group not found or already inactive',
            requestId: req.id,
            details:   [],
          },
        })
      }

      return reply.status(204).send()
    }
  )
}