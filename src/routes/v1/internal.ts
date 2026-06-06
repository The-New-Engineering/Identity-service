import type { FastifyInstance } from 'fastify'

/**
 * Internal routes — service-to-service only.
 *
 * Protected by MEMBER_SERVICE_API_KEY header, not JWT.
 * These routes are not in the public OpenAPI contract.
 * In production, restrict access to the Docker internal network only.
 *
 * Usage from member service:
 *   GET /internal/members/:id
 *   GET /internal/members
 *
 * with header:
 *   x-internal-api-key: <MEMBER_SERVICE_API_KEY>
 */

export default async function internalRoute(app: FastifyInstance) {

  // ── API key guard ─────────────────────────────────────────────────────────

  /**
   * All internal routes share this preHandler.
   * Validates the x-internal-api-key header against
   * the MEMBER_SERVICE_API_KEY env variable.
   */
  async function requireApiKey(req: any, reply: any): Promise<void> {
    const key = req.headers['x-internal-api-key']

    if (!key || key !== app.config.MEMBER_SERVICE_API_KEY) {
      return reply.status(401).send({
        error: {
          code:      'INVALID_API_KEY',
          message:   'Invalid or missing API key',
          requestId: req.id,
          details:   [],
        },
      })
    }
  }

  // ── Get single member ─────────────────────────────────────────────────────

  /**
   * GET /internal/members/:id
   * Returns full member identity record for a given UUID.
   * Used by the member service to fetch identity context
   * when building a combined member profile response.
   */
  app.get<{ Params: { id: string } }>(
    '/members/:id', {
      preHandler: requireApiKey,
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `SELECT
           m.id, m.email,
           m.first_name, m.last_name,
           m.phone, m.address, m.date_of_birth,
           m.status, m.is_migrated,
           m.placement_complete,
           m.installation_id, m.nation_id,
           m.tribe_id, m.workforce_team_id,
           m.created_at, m.updated_at,
           i.name  AS installation_name,
           i.code  AS installation_code,
           n.name  AS nation_name,
           t.name  AS tribe_name,
           wt.name AS workforce_team_name,
           r.name  AS role_name,
           COALESCE(
             json_agg(DISTINCT ig.name) FILTER (WHERE ig.id IS NOT NULL),
             '[]'
           ) AS interest_groups,
           COALESCE(
             json_agg(DISTINCT ag.name) FILTER (WHERE ag.id IS NOT NULL),
             '[]'
           ) AS affinity_groups
         FROM members m
         LEFT JOIN installations  i   ON i.id  = m.installation_id
         LEFT JOIN nations        n   ON n.id  = m.nation_id
         LEFT JOIN tribes         t   ON t.id  = m.tribe_id
         LEFT JOIN workforce_teams wt ON wt.id = m.workforce_team_id
         LEFT JOIN roles          r   ON r.id  = m.role_id
         LEFT JOIN member_interest_groups mig ON mig.member_id = m.id
         LEFT JOIN interest_groups ig ON ig.id = mig.interest_group_id AND ig.is_active = TRUE
         LEFT JOIN member_affinity_groups mag ON mag.member_id = m.id
         LEFT JOIN affinity_groups ag ON ag.id = mag.affinity_group_id AND ag.is_active = TRUE
         WHERE m.id = $1
           AND m.deleted_at IS NULL
         GROUP BY
           m.id, i.id, n.id, t.id, wt.id, r.id`,
        [req.params.id]
      )

      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'MEMBER_NOT_FOUND',
            message:   'Member not found',
            requestId: req.id,
            details:   [],
          },
        })
      }

      return reply.send({ data: rows[0] })
    }
  )

  // ── List members ──────────────────────────────────────────────────────────

  /**
   * GET /internal/members
   * Returns a paginated list of member identity records.
   * Used by the member service when listing members with enrichment data.
   *
   * Supports the same filters as the public members list endpoint
   * so the member service can pass through query parameters directly.
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
  }>('/members', {
    preHandler: requireApiKey,
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
    const conditions: string[] = ['m.deleted_at IS NULL']
    const values: any[]        = []
    let   paramIndex           = 1

    if (req.query.installationId) {
      conditions.push(`m.installation_id = $${paramIndex++}`)
      values.push(req.query.installationId)
    }
    if (req.query.nationId) {
      conditions.push(`m.nation_id = $${paramIndex++}`)
      values.push(req.query.nationId)
    }
    if (req.query.tribeId) {
      conditions.push(`m.tribe_id = $${paramIndex++}`)
      values.push(req.query.tribeId)
    }
    if (req.query.workforceTeamId) {
      conditions.push(`m.workforce_team_id = $${paramIndex++}`)
      values.push(req.query.workforceTeamId)
    }
    if (req.query.status) {
      conditions.push(`m.status = $${paramIndex++}`)
      values.push(req.query.status)
    }

    const where  = `WHERE ${conditions.join(' AND ')}`
    const limit  = req.query.limit  ?? 20
    const offset = req.query.offset ?? 0

    const [countRows, memberRows] = await Promise.all([
      app.db.unsafe(
        `SELECT COUNT(DISTINCT m.id)::int AS total
         FROM members m ${where}`,
        values
      ),
      app.db.unsafe(
        `SELECT
           m.id, m.email,
           m.first_name, m.last_name,
           m.phone, m.status,
           m.placement_complete,
           m.installation_id, m.nation_id,
           m.tribe_id, m.workforce_team_id,
           m.created_at,
           i.name  AS installation_name,
           i.code  AS installation_code,
           n.name  AS nation_name,
           t.name  AS tribe_name,
           wt.name AS workforce_team_name,
           r.name  AS role_name
         FROM members m
         LEFT JOIN installations   i  ON i.id  = m.installation_id
         LEFT JOIN nations         n  ON n.id  = m.nation_id
         LEFT JOIN tribes          t  ON t.id  = m.tribe_id
         LEFT JOIN workforce_teams wt ON wt.id = m.workforce_team_id
         LEFT JOIN roles           r  ON r.id  = m.role_id
         ${where}
         ORDER BY m.last_name ASC, m.first_name ASC
         LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        [...values, limit, offset]
      ),
    ])

    return reply.send({
      data: memberRows,
      meta: {
        total:  (countRows[0] as any).total,
        limit,
        offset,
      },
    })
  })

  // ── Verify member exists ──────────────────────────────────────────────────

  /**
   * GET /internal/members/:id/exists
   * Lightweight existence check — returns 200 or 404.
   * Used by the member service before creating an enrichment profile
   * to confirm the member_id is valid.
   */
  app.get<{ Params: { id: string } }>(
    '/members/:id/exists', {
      preHandler: requireApiKey,
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `SELECT id FROM members
         WHERE id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      )

      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'MEMBER_NOT_FOUND',
            message:   'Member not found',
            requestId: req.id,
            details:   [],
          },
        })
      }

      return reply.status(200).send({ exists: true })
    }
  )
}