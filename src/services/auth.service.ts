import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import { MemberService } from './member.service'
import { TokenService } from './token.service'
import { MigrationService } from './migration.service'
import { EmailService } from './email.service'
import { GoogleProvider } from '../providers/oauth/google'
import { AppleProvider } from '../providers/oauth/apple'
import { FacebookProvider } from '../providers/oauth/facebook'
import type { IOAuthProvider } from '../providers/oauth/interface'
import type { TokenPair, MigrationRequiredResponse, OAuthProvider } from '../types/auth'

const RESET_KEY_PREFIX = 'reset:'

export class AuthService {
  private members: MemberService
  private tokens: TokenService
  private migration: MigrationService
  private email: EmailService
  private oauthProviders: Map<string, IOAuthProvider>

  constructor(private app: FastifyInstance) {
    this.members  = new MemberService(app)
    this.tokens   = new TokenService(app)
    this.migration = new MigrationService(app)
    this.email    = new EmailService(app)

    const providers: Array<[string, IOAuthProvider]> = [
      [
        'google', new GoogleProvider(
        app.config.GOOGLE_CLIENT_ID,
        app.config.GOOGLE_CLIENT_SECRET,
        app.cache
      )],
      ['apple',    new AppleProvider(app.config.APPLE_CLIENT_ID, app.config.APPLE_TEAM_ID, app.config.APPLE_KEY_ID, app.config.APPLE_CLIENT_SECRET)],
      ['facebook', new FacebookProvider(app.config.FACEBOOK_CLIENT_ID, app.config.FACEBOOK_CLIENT_SECRET)],
    ]
    this.oauthProviders = new Map(providers)
  }

  // ── Registration ──────────────────────────────────────────────────────────

  async register(data: {
    email: string
    password: string
    firstName: string
    lastName: string
    installationId: string       // required
    nationId?: string
    tribeId?: string
    workforceTeamId?: string
    phone?: string
    address?: string
    dateOfBirth?: string
  }): Promise<TokenPair> {
    // Validate installation exists before creating the member
    const installation = await this.app.db.unsafe(
      `SELECT id FROM installations
      WHERE id = $1 AND is_active = TRUE`,
      [data.installationId]
    )

    if (!installation[0]) {
      throw Object.assign(
        new Error('Installation not found or inactive'),
        { statusCode: 400, code: 'INVALID_INSTALLATION' }
      )
    }

    const existing = await this.members.findByEmail(data.email)
    if (existing) {
      throw Object.assign(
        new Error('Email already registered'),
        { statusCode: 409, code: 'EMAIL_TAKEN' }
      )
    }

    const member = await this.members.create(data)
    const { role, scopes } = await this.tokens.getMemberScopes(member.id)
    const org = this.members.buildOrgContext(member)

    return this.tokens.issue(member.id, member.email, role, org, scopes)
  }

  // ── Login — central decision point ────────────────────────────────────────

  async login(email: string, password: string): Promise<TokenPair | MigrationRequiredResponse> {
    const member = await this.members.findByEmail(email)

    if (!member) {
      throw Object.assign(new Error('Invalid credentials'), { statusCode: 401, code: 'INVALID_CREDENTIALS' })
    }

    if (member.status !== 'active') {
      throw Object.assign(new Error('Account is not active'), { statusCode: 403, code: 'ACCOUNT_INACTIVE' })
    }

    // Legacy member — no credential yet, trigger migration
    if (!member.is_migrated) {
      const migrationToken = await this.migration.issueMigrationToken(member.id, member.email)
      await this.email.sendMigrationEmail(member.email, migrationToken)
      return this.migration.buildMigrationResponse(migrationToken)
    }

    // Social-only member — password_hash is null
    if (!member.password_hash) {
      throw Object.assign(
        new Error('This account uses social login'),
        { statusCode: 401, code: 'USE_SOCIAL_LOGIN' }
      )
    }

    const valid = await this.members.verifyPassword(member, password)
    if (!valid) {
      throw Object.assign(new Error('Invalid credentials'), { statusCode: 401, code: 'INVALID_CREDENTIALS' })
    }

    const org    = this.members.buildOrgContext(member)
    const { role, scopes } = await this.tokens.getMemberScopes(member.id)
    return this.tokens.issue(member.id, member.email, role,org, scopes)
  }

  // ── Migration — password path ─────────────────────────────────────────────

  async migrateWithPassword(migrationToken: string, password: string): Promise<TokenPair> {
    const { memberId } = await this.migration.verifyMigrationToken(migrationToken)
    await this.members.setPassword(memberId, password)

    const member = await this.members.findById(memberId)
    if (!member) throw new Error('MEMBER_NOT_FOUND')

    const org    = this.members.buildOrgContext(member)
    const { role, scopes } = await this.tokens.getMemberScopes(member.id)
    return this.tokens.issue(member.id, member.email, role, org, scopes)
  }

  // ── OAuth flows ───────────────────────────────────────────────────────────

  async getOAuthRedirectUrl(
    providerName: OAuthProvider,
    state: string,
    migrating = false,
    installationCode?: string    // ← new optional param
  ): Promise<string> {
    const provider = this.oauthProviders.get(providerName)
    if (!provider) {
      throw Object.assign(
        new Error('Unknown provider'),
        { statusCode: 400, code: 'UNKNOWN_PROVIDER' }
      )
    }

    const path = migrating
      ? `/v1/auth/migrate/oauth/${providerName}/callback`
      : `/v1/auth/oauth/${providerName}/callback`

    const redirectUri = `${this.app.config.APP_BASE_URL}${path}`

    // Encode installation code into state so it survives the OAuth redirect
    const enrichedState = installationCode
      ? Buffer.from(JSON.stringify({
          original: state,
          installationCode,
        })).toString('base64url')
      : state

    return provider.getAuthUrl(enrichedState, redirectUri)
  }


  async handleOAuthCallback(
    providerName: OAuthProvider,
    code: string,
    state: string,
    migrationToken?: string
  ): Promise<TokenPair> {
    const provider = this.oauthProviders.get(providerName)
    if (!provider) {
      throw Object.assign(
        new Error('Unknown provider'),
        { statusCode: 400, code: 'UNKNOWN_PROVIDER' }
      )
    }

    const redirectUri = `${this.app.config.APP_BASE_URL}/v1/auth/oauth/${providerName}/callback`
    const profile = await provider.exchangeCode(code, redirectUri, state)

    // Decode installation code from state if present
    let installationId: string | undefined
    try {
      const decoded = JSON.parse(
        Buffer.from(state, 'base64url').toString()
      ) as { original: string; installationCode?: string }

      if (decoded.installationCode) {
        // Resolve installation code to UUID
        const rows = await this.app.db.unsafe(
          `SELECT id FROM installations
          WHERE code = $1 AND is_active = TRUE`,
          [decoded.installationCode]
        )
        if (rows[0]) {
          installationId = (rows[0] as any).id
        }
      }
    } catch {
      // State is a plain string — no installation context encoded
      // This is valid for social logins not originating from a registration URL
    }

    let memberId: string

    if (migrationToken) {
      // Migration path — link social identity to existing legacy member
      const { memberId: legacyId } = await this.migration.verifyMigrationToken(migrationToken)
      await this.app.db.unsafe(
        `INSERT INTO member_identities (member_id, provider, provider_id, email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (provider, provider_id) DO NOTHING`,
        [legacyId, providerName, profile.providerId, profile.email]
      )
      await this.members.markMigrated(legacyId)
      memberId = legacyId
    } else {
      // Normal path — find or create member
      // Pass installationId so new OAuth members get placed correctly
      const member = await this.members.findOrCreateFromOAuth(
        providerName,
        profile.providerId,
        profile.email,
        profile.firstName,
        profile.lastName,
        installationId     // ← pass resolved installation ID
      )
      memberId = member.id
    }

    const member = await this.members.findById(memberId)
    if (!member) throw new Error('MEMBER_NOT_FOUND')

    const { role, scopes } = await this.tokens.getMemberScopes(member.id)
    const org = this.members.buildOrgContext(member)

    return this.tokens.issue(member.id, member.email, role, org, scopes)
  }

  // ── Password reset ────────────────────────────────────────────────────────

  async requestPasswordReset(email: string): Promise<void> {
    const member = await this.members.findByEmail(email)
    if (!member) return  // Silent — don't leak whether email exists

    const token = crypto.randomBytes(32).toString('hex')
    const ttl   = parseInt(this.app.config.RESET_TOKEN_TTL, 10)
    await this.app.cache.set(`${RESET_KEY_PREFIX}${token}`, member.id, 'EX', ttl)
    await this.email.sendPasswordResetEmail(email, token)
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const memberId = await this.app.cache.get(`${RESET_KEY_PREFIX}${token}`)
    if (!memberId) {
      throw Object.assign(
        new Error('Invalid or expired reset token'),
        { statusCode: 400, code: 'INVALID_RESET_TOKEN' }
      )
    }
    await this.app.cache.del(`${RESET_KEY_PREFIX}${token}`)
    await this.members.setPassword(memberId, newPassword)
    await this.tokens.revokeAll(memberId)   // Force re-login everywhere
  }

  // ── Session ───────────────────────────────────────────────────────────────

  async refresh(refreshToken: string): Promise<string> {
    try {
      return await this.tokens.refresh(refreshToken)
    } catch (err: any) {
      throw Object.assign(
        new Error('Invalid or expired refresh token'),
        { statusCode: 401, code: err.message ?? 'INVALID_TOKEN' }
      )
    }
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken)
  }

  // ── Token verification for other services ─────────────────────────────────

  verifyToken(token: string) {
    try {
      return this.tokens.verify(token)
    } catch {
      throw Object.assign(new Error('Invalid token'), { statusCode: 401, code: 'INVALID_TOKEN' })
    }
  }
}
