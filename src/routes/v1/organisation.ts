import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../middleware/verify-token'

export default async function organisationsRoute(app: FastifyInstance) {

  // ── Installations ──────────────────────────────────────────────────────────

  app.post<{ Body: { name: string; code: string; timezone?: string } }>(
    '/installations', {
      preHandler: requireAuth('org.installation.create'),
      schema: {
        body: {
          type: 'object',
          required: ['name', 'code'],
          properties: {
            name:     { type: 'string', minLength: 1 },
            code:     { type: 'string', minLength: 1 },
            timezone: { type: 'string' },
          },
        },
      },
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `INSERT INTO installations (name, code, timezone)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [req.body.name, req.body.code, req.body.timezone ?? 'UTC']
      )
      return reply.status(201).send({ data: rows[0] })
    }
  )

  app.get('/installations', {
    preHandler: requireAuth('org.installation.read'),
  }, async (_req, reply) => {
    const rows = await app.db.unsafe(
      `SELECT * FROM installations ORDER BY name ASC`
    )
    return reply.send({ data: rows })
  })

  app.get<{ Params: { id: string } }>(
    '/installations/:id', {
      preHandler: requireAuth('org.installation.read'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `SELECT * FROM installations WHERE id = $1`,
        [req.params.id]
      )
      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'NOT_FOUND',
            message:   'Installation not found',
            requestId: req.id,
            details:   [],
          },
        })
      }
      return reply.send({ data: rows[0] })
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/installations/:id', {
      preHandler: requireAuth('org.installation.delete'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `UPDATE installations
         SET is_active = FALSE
         WHERE id = $1 AND is_active = TRUE
         RETURNING id`,
        [req.params.id]
      )
      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'NOT_FOUND',
            message:   'Installation not found or already inactive',
            requestId: req.id,
            details:   [],
          },
        })
      }
      return reply.status(204).send()
    }
  )

  // ── Nations ────────────────────────────────────────────────────────────────

  app.post<{ Body: { name: string; installationId: string; description?: string } }>(
    '/nations', {
      preHandler: requireAuth('org.nation.create'),
      schema: {
        body: {
          type: 'object',
          required: ['name', 'installationId'],
          properties: {
            name:           { type: 'string', minLength: 1 },
            installationId: { type: 'string' },
            description:    { type: 'string' },
          },
        },
      },
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `INSERT INTO nations (name, installation_id, description)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [req.body.name, req.body.installationId, req.body.description ?? null]
      )
      return reply.status(201).send({ data: rows[0] })
    }
  )

  app.get<{ Querystring: { installationId?: string } }>(
    '/nations', {
      preHandler: requireAuth('org.nation.read'),
    }, async (req, reply) => {
      const rows = req.query.installationId
        ? await app.db.unsafe(
            `SELECT * FROM nations
             WHERE installation_id = $1
             ORDER BY name ASC`,
            [req.query.installationId]
          )
        : await app.db.unsafe(
            `SELECT * FROM nations ORDER BY name ASC`
          )
      return reply.send({ data: rows })
    }
  )

  app.get<{ Params: { id: string } }>(
    '/nations/:id', {
      preHandler: requireAuth('org.nation.read'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `SELECT
           n.*,
           i.name AS installation_name,
           i.code AS installation_code
         FROM nations n
         JOIN installations i ON i.id = n.installation_id
         WHERE n.id = $1`,
        [req.params.id]
      )
      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'NOT_FOUND',
            message:   'Nation not found',
            requestId: req.id,
            details:   [],
          },
        })
      }
      return reply.send({ data: rows[0] })
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/nations/:id', {
      preHandler: requireAuth('org.nation.delete'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `UPDATE nations
         SET is_active = FALSE
         WHERE id = $1 AND is_active = TRUE
         RETURNING id`,
        [req.params.id]
      )
      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'NOT_FOUND',
            message:   'Nation not found or already inactive',
            requestId: req.id,
            details:   [],
          },
        })
      }
      return reply.status(204).send()
    }
  )

  // ── Tribes ─────────────────────────────────────────────────────────────────

  app.post<{ Body: { name: string; nationId: string; description?: string } }>(
    '/tribes', {
      preHandler: requireAuth('org.tribe.create'),
      schema: {
        body: {
          type: 'object',
          required: ['name', 'nationId'],
          properties: {
            name:        { type: 'string', minLength: 1 },
            nationId:    { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `INSERT INTO tribes (name, nation_id, description)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [req.body.name, req.body.nationId, req.body.description ?? null]
      )
      return reply.status(201).send({ data: rows[0] })
    }
  )

  app.get<{ Querystring: { nationId?: string } }>(
    '/tribes', {
      preHandler: requireAuth('org.tribe.read'),
    }, async (req, reply) => {
      const rows = req.query.nationId
        ? await app.db.unsafe(
            `SELECT * FROM tribes
             WHERE nation_id = $1
             ORDER BY name ASC`,
            [req.query.nationId]
          )
        : await app.db.unsafe(
            `SELECT * FROM tribes ORDER BY name ASC`
          )
      return reply.send({ data: rows })
    }
  )

  app.get<{ Params: { id: string } }>(
    '/tribes/:id', {
      preHandler: requireAuth('org.tribe.read'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `SELECT
           t.*,
           n.name AS nation_name,
           i.name AS installation_name,
           i.code AS installation_code
         FROM tribes t
         JOIN nations n       ON n.id = t.nation_id
         JOIN installations i ON i.id = n.installation_id
         WHERE t.id = $1`,
        [req.params.id]
      )
      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'NOT_FOUND',
            message:   'Tribe not found',
            requestId: req.id,
            details:   [],
          },
        })
      }
      return reply.send({ data: rows[0] })
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/tribes/:id', {
      preHandler: requireAuth('org.tribe.delete'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `UPDATE tribes
         SET is_active = FALSE
         WHERE id = $1 AND is_active = TRUE
         RETURNING id`,
        [req.params.id]
      )
      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'NOT_FOUND',
            message:   'Tribe not found or already inactive',
            requestId: req.id,
            details:   [],
          },
        })
      }
      return reply.status(204).send()
    }
  )

  // ── Workforce Teams ────────────────────────────────────────────────────────

  app.post<{ Body: { name: string; description?: string } }>(
    '/workforce-teams', {
      preHandler: requireAuth('org.workforce.create'),
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
        `INSERT INTO workforce_teams (name, description)
         VALUES ($1, $2)
         RETURNING *`,
        [req.body.name, req.body.description ?? null]
      )
      return reply.status(201).send({ data: rows[0] })
    }
  )

  app.get('/workforce-teams', {
    preHandler: requireAuth('org.workforce.read'),
  }, async (_req, reply) => {
    const rows = await app.db.unsafe(
      `SELECT * FROM workforce_teams ORDER BY name ASC`
    )
    return reply.send({ data: rows })
  })

  app.get<{ Params: { id: string } }>(
    '/workforce-teams/:id', {
      preHandler: requireAuth('org.workforce.read'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `SELECT * FROM workforce_teams WHERE id = $1`,
        [req.params.id]
      )
      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'NOT_FOUND',
            message:   'Workforce team not found',
            requestId: req.id,
            details:   [],
          },
        })
      }
      return reply.send({ data: rows[0] })
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/workforce-teams/:id', {
      preHandler: requireAuth('org.workforce.delete'),
    }, async (req, reply) => {
      const rows = await app.db.unsafe(
        `UPDATE workforce_teams
         SET is_active = FALSE
         WHERE id = $1 AND is_active = TRUE
         RETURNING id`,
        [req.params.id]
      )
      if (!rows[0]) {
        return reply.status(404).send({
          error: {
            code:      'NOT_FOUND',
            message:   'Workforce team not found or already inactive',
            requestId: req.id,
            details:   [],
          },
        })
      }
      return reply.status(204).send()
    }
  )
}