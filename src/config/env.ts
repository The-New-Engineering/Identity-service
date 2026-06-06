import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import env from '@fastify/env'

const schema = {
  type: 'object',
  required: [
    'SERVICE_NAME', 'NODE_ENV', 'PORT',
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY',
    'APP_BASE_URL', 'FRONTEND_URL',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
  ],
  properties: {
    // ── Bucket 1: Platform ─────────────────────────────────────────
    SERVICE_NAME: { type: 'string' },
    NODE_ENV: { type: 'string', enum: ['development', 'production', 'test'], default: 'development' },
    PORT: { type: 'string', default: '3000' },
    LOG_LEVEL: { type: 'string', default: 'info' },

    // ── Bucket 2: Infrastructure ───────────────────────────────────
    DATABASE_URL: { type: 'string' },
    DATABASE_POOL_MAX: { type: 'string', default: '10' },
    REDIS_URL: { type: 'string' },

    // ── Bucket 3: JWT ──────────────────────────────────────────────
    JWT_PRIVATE_KEY: { type: 'string' },   // RS256 PEM — newlines as \n
    JWT_PUBLIC_KEY: { type: 'string' },    // RS256 PEM — newlines as \n
    JWT_EXPIRY: { type: 'string', default: '900' },
    REFRESH_TOKEN_EXPIRY: { type: 'string', default: '604800' },

    // ── Bucket 4: Migration + Reset tokens ─────────────────────────
    MIGRATION_TOKEN_TTL: { type: 'string', default: '900' },
    RESET_TOKEN_TTL: { type: 'string', default: '3600' },

    // ── Bucket 5: SMTP ─────────────────────────────────────────────
    SMTP_HOST: { type: 'string' },
    SMTP_PORT: { type: 'string', default: '587' },
    SMTP_USER: { type: 'string' },
    SMTP_PASS: { type: 'string' },
    SMTP_FROM: { type: 'string' },

    // ── Bucket 6: OAuth providers ──────────────────────────────────
    GOOGLE_CLIENT_ID: { type: 'string', default: '' },
    GOOGLE_CLIENT_SECRET: { type: 'string', default: '' },

    APPLE_CLIENT_ID: { type: 'string', default: '' },
    APPLE_CLIENT_SECRET: { type: 'string', default: '' },
    APPLE_TEAM_ID: { type: 'string', default: '' },
    APPLE_KEY_ID: { type: 'string', default: '' },

    FACEBOOK_CLIENT_ID: { type: 'string', default: '' },
    FACEBOOK_CLIENT_SECRET: { type: 'string', default: '' },

    // ── Bucket 7: App URLs ─────────────────────────────────────────
    APP_BASE_URL: { type: 'string' },
    FRONTEND_URL: { type: 'string' },
    MEMBER_SERVICE_API_KEY: { type: 'string', default: '' },
  },
}

export default fp(async (app: FastifyInstance) => {
  await app.register(env, { schema, dotenv: true })
})

declare module 'fastify' {
  interface FastifyInstance {
    config: {
      SERVICE_NAME: string
      NODE_ENV: string
      PORT: string
      LOG_LEVEL: string
      DATABASE_URL: string
      DATABASE_POOL_MAX: string
      REDIS_URL: string
      JWT_PRIVATE_KEY: string
      JWT_PUBLIC_KEY: string
      JWT_EXPIRY: string
      REFRESH_TOKEN_EXPIRY: string
      MIGRATION_TOKEN_TTL: string
      RESET_TOKEN_TTL: string
      SMTP_HOST: string
      SMTP_PORT: string
      SMTP_USER: string
      SMTP_PASS: string
      SMTP_FROM: string
      GOOGLE_CLIENT_ID: string
      GOOGLE_CLIENT_SECRET: string
      APPLE_CLIENT_ID: string
      APPLE_CLIENT_SECRET: string
      APPLE_TEAM_ID: string
      APPLE_KEY_ID: string
      FACEBOOK_CLIENT_ID: string
      FACEBOOK_CLIENT_SECRET: string
      APP_BASE_URL: string
      FRONTEND_URL: string
      MEMBER_SERVICE_API_KEY: string
    }
  }
}
