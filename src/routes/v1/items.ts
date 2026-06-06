import type { FastifyInstance } from 'fastify'

/**
 * Example resource route.
 * Replace 'items' with your domain resource.
 * Each route file owns one resource.
 */

interface Item {
  id: string
  name: string
  createdAt: string
}

// Replace with your DB layer when ENABLE_DB=true
const store = new Map<string, Item>()

export default async function itemsRoute(app: FastifyInstance) {

  // GET /v1/items
  app.get('/', async (_req, reply) => {
    return reply.send({ data: Array.from(store.values()) })
  })

  // GET /v1/items/:id
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const item = store.get(req.params.id)
    if (!item) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Item not found', requestId: req.id, details: [] },
      })
    }
    return reply.send({ data: item })
  })

  // POST /v1/items
  app.post<{ Body: { name: string } }>('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const item: Item = {
      id: crypto.randomUUID(),
      name: req.body.name,
      createdAt: new Date().toISOString(),
    }
    store.set(item.id, item)
    return reply.status(201).send({ data: item })
  })

  // DELETE /v1/items/:id
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    if (!store.has(req.params.id)) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Item not found', requestId: req.id, details: [] },
      })
    }
    store.delete(req.params.id)
    return reply.status(204).send()
  })
}
