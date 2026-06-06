import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import type { OAuthProvider } from '../types/auth'

const MIGRATION_KEY_PREFIX = 'migration:'

export class MigrationService {
  constructor(private app: FastifyInstance) {}

  /**
   * Issue a short-lived migration token for a legacy member.
   * Stored in Redis — proves email ownership without a credential.
   */
  async issueMigrationToken(memberId: string, email: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex')
    const ttl = parseInt(this.app.config.MIGRATION_TOKEN_TTL, 10)
    const key = `${MIGRATION_KEY_PREFIX}${token}`

    await this.app.cache.set(key, JSON.stringify({ memberId, email }), 'EX', ttl)

    return token
  }

  /**
   * Verify a migration token and return the associated member context.
   * Consumes the token — single use only.
   */
  async verifyMigrationToken(token: string): Promise<{ memberId: string; email: string }> {
    const key = `${MIGRATION_KEY_PREFIX}${token}`
    const raw = await this.app.cache.get(key)

    if (!raw) throw new Error('INVALID_MIGRATION_TOKEN')

    // Consume immediately — single use
    await this.app.cache.del(key)

    return JSON.parse(raw)
  }

  /**
   * Re-issue a migration token without consuming the original.
   * Used when redirecting through OAuth — token must survive the redirect.
   */
  async peekMigrationToken(token: string): Promise<{ memberId: string; email: string }> {
    const key = `${MIGRATION_KEY_PREFIX}${token}`
    const raw = await this.app.cache.get(key)

    if (!raw) throw new Error('INVALID_MIGRATION_TOKEN')

    return JSON.parse(raw)
  }

  buildMigrationResponse(migrationToken: string) {
    return {
      status: 'migration_required' as const,
      message: 'Your account needs to be secured before you can continue.',
      migrationToken,
      options: ['google', 'apple', 'facebook'] as OAuthProvider[],
    }
  }
}
