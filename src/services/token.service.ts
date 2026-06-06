import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import type { JwtPayload, TokenPair } from '../types/auth'

export class TokenService {
  constructor(private app: FastifyInstance) {}

  // After
  async issue(
    memberId: string,
    email: string,
    role: string,
    org: JwtPayload['org'],
    scopes: string[]
  ): Promise<TokenPair> {
    const privateKey = this.app.config.JWT_PRIVATE_KEY.replace(/\\n/g, '\n')
    const expiry = parseInt(this.app.config.JWT_EXPIRY, 10)

    const payload: JwtPayload = { sub: memberId, email, role, org, scopes }

    const accessToken = jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      expiresIn: expiry,
    })

    const rawToken = crypto.randomBytes(64).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(
      Date.now() + parseInt(this.app.config.REFRESH_TOKEN_EXPIRY, 10) * 1000
    )

    await this.app.db.unsafe(
      `INSERT INTO refresh_tokens (member_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [memberId, tokenHash, expiresAt]
    )

    return { accessToken, refreshToken: rawToken }
  }

  verify(token: string): JwtPayload {
    const publicKey = this.app.config.JWT_PUBLIC_KEY.replace(/\\n/g, '\n')
    return jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as JwtPayload
  }

  async refresh(rawToken: string): Promise<string> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    const rows = await this.app.db.unsafe(
      `SELECT rt.member_id, rt.expires_at, rt.revoked_at,
              m.email, m.tribe_id, m.workforce_team_id,
              t.nation_id, n.installation_id
       FROM refresh_tokens rt
       JOIN members m ON m.id = rt.member_id
       LEFT JOIN tribes t ON t.id = m.tribe_id
       LEFT JOIN nations n ON n.id = t.nation_id
       WHERE rt.token_hash = $1 AND m.deleted_at IS NULL`,
      [tokenHash]
    )

    const stored = rows[0] as any
    if (!stored)          throw new Error('INVALID_TOKEN')
    if (stored.revoked_at) throw new Error('TOKEN_REVOKED')
    if (new Date(stored.expires_at) < new Date()) throw new Error('TOKEN_EXPIRED')

    // After
  const { role, scopes } = await this.getMemberScopes(stored.member_id)
  const privateKey = this.app.config.JWT_PRIVATE_KEY.replace(/\\n/g, '\n')

  const payload: JwtPayload = {
    sub: stored.member_id,
    email: stored.email,
    role,
    org: {
      installation_id: stored.installation_id ?? null,
      nation_id: stored.nation_id ?? null,
      tribe_id: stored.tribe_id ?? null,
      workforce_team_id: stored.workforce_team_id ?? null,
    },
    scopes,
  }

    return jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      expiresIn: parseInt(this.app.config.JWT_EXPIRY, 10),
    })
  }

  async revoke(rawToken: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    await this.app.db.unsafe(
      `UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash]
    )
  }

  async revokeAll(memberId: string): Promise<void> {
    await this.app.db.unsafe(
      `UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE member_id = $1 AND revoked_at IS NULL`,
      [memberId]
    )
  }

  // After
async getMemberScopes(memberId: string): Promise<{ role: string; scopes: string[] }> {
    // Fetch member's role
    const memberRows = await this.app.db.unsafe(
      `SELECT r.name as role_name
      FROM members m
      LEFT JOIN roles r ON r.id = m.role_id
      WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [memberId]
    )

    const roleName = (memberRows[0] as any)?.role_name ?? 'user'

    // Fetch scopes from three sources and merge:
    //   1. Role scopes       — scopes belonging to the member's role
    //   2. Member scopes     — individual grants (extensions for custom members)
    //   3. Global scopes     — scopes every member gets regardless of role
    const scopeRows = await this.app.db.unsafe(
      `SELECT DISTINCT s.name
      FROM scopes s
      WHERE s.is_archived = FALSE
        AND (
          -- Role scopes
          s.id IN (
            SELECT rs.scope_id
            FROM role_scopes rs
            JOIN roles r ON r.id = rs.role_id
            JOIN members m ON m.role_id = r.id
            WHERE m.id = $1
          )
          OR
          -- Individual member scopes (custom extensions)
          s.id IN (
            SELECT ms.scope_id
            FROM member_scopes ms
            WHERE ms.member_id = $1
          )
          OR
          -- Global scopes
          s.is_global = TRUE
        )`,
      [memberId]
    )

    const scopes = (scopeRows as any[]).map((r) => r.name as string)

    return { role: roleName, scopes }
  }
}
