import type { FastifyInstance } from 'fastify'
import { hasRole } from '../middleware/verify-token'

/**
 * Scopes that operational admins (admin role) are permitted to grant
 * without triggering a custom role transition.
 *
 * Tech admins (superadmin role) can grant any scope.
 */
const ADMIN_GRANTABLE_SCOPES = new Set([
  'members.profile.read',
  'members.profile.write',
  'checkin.attendance.write',
  'checkin.attendance.read',
  'org.installation.read',
  'org.nation.read',
  'org.tribe.read',
  'org.workforce.read',
])

export interface ScopeRow {
  id: string
  name: string
  description: string | null
  is_global: boolean
  is_archived: boolean
  created_at: Date
}

export interface MemberScopeRow {
  scope_id: string
  name: string
  description: string | null
  is_global: boolean
  granted_by: string | null
  granted_at: Date
}

export interface RoleRow {
  id: string
  name: string
  description: string | null
  created_at: Date
}

export interface RoleScopeRow {
  scope_id: string
  name: string
  description: string | null
}

export class PermissionsService {
  constructor(private app: FastifyInstance) {}

  // ── Scope definitions ──────────────────────────────────────────────

  async createScope(data: {
    name: string
    description?: string
    isGlobal?: boolean
  }): Promise<ScopeRow> {
    const rows = await this.app.db.unsafe(
      `INSERT INTO scopes (name, description, is_global)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.name, data.description ?? null, data.isGlobal ?? false]
    )
    return rows[0] as unknown as ScopeRow
  }

  async listScopes(includeArchived = false): Promise<ScopeRow[]> {
    const rows = await this.app.db.unsafe(
      `SELECT * FROM scopes
       WHERE ($1 = TRUE OR is_archived = FALSE)
       ORDER BY name ASC`,
      [includeArchived]
    )
    return rows as unknown as ScopeRow[]
  }

  /**
   * Archive a scope — prevents it from being granted to new members
   * but does not remove it from members who already hold it.
   * The scope will no longer appear in new tokens once archived.
   */
  async archiveScope(scopeId: string): Promise<ScopeRow | null> {
    const rows = await this.app.db.unsafe(
      `UPDATE scopes
       SET is_archived = TRUE
       WHERE id = $1 AND is_archived = FALSE
       RETURNING *`,
      [scopeId]
    )
    return (rows[0] as unknown as ScopeRow) ?? null
  }

  async restoreScope(scopeId: string): Promise<ScopeRow | null> {
    const rows = await this.app.db.unsafe(
      `UPDATE scopes
       SET is_archived = FALSE
       WHERE id = $1 AND is_archived = TRUE
       RETURNING *`,
      [scopeId]
    )
    return (rows[0] as unknown as ScopeRow) ?? null
  }

  // ── Role management ────────────────────────────────────────────────

  async listRoles(): Promise<RoleRow[]> {
    const rows = await this.app.db.unsafe(
      `SELECT * FROM roles ORDER BY name ASC`
    )
    return rows as unknown as RoleRow[]
  }

  async getRoleScopes(roleId: string): Promise<RoleScopeRow[]> {
    const rows = await this.app.db.unsafe(
      `SELECT s.id as scope_id, s.name, s.description
       FROM role_scopes rs
       JOIN scopes s ON s.id = rs.scope_id
       WHERE rs.role_id = $1
         AND s.is_archived = FALSE
       ORDER BY s.name ASC`,
      [roleId]
    )
    return rows as unknown as RoleScopeRow[]
  }

  /**
   * Assign a standard role to a member.
   *
   * Rules:
   *   - superadmin can assign any role
   *   - admin can assign operator, user — cannot assign admin or superadmin
   *   - operator and below cannot assign roles
   *
   * When a role is assigned:
   *   - Any individual scope grants (member_scopes) are cleared
   *     since the new role defines the member's access from scratch
   *   - Refresh tokens are revoked — forces re-login with new role scopes
   */
  async assignRole(data: {
    targetMemberId: string
    roleName: string
    callerRole: string
  }): Promise<void> {
    const { targetMemberId, roleName, callerRole } = data

    // custom cannot be assigned directly — it is a derived state
    if (roleName === 'custom') {
      throw Object.assign(
        new Error('The custom role cannot be assigned directly. Grant additional scopes to trigger the transition.'),
        { statusCode: 400, code: 'INVALID_ROLE_ASSIGNMENT' }
      )
    }

    // Enforce role assignment hierarchy
    const canAssign = (() => {
      if (callerRole === 'superadmin') return true
      if (callerRole === 'admin') {
        return roleName === 'operator' || roleName === 'user'
      }
      return false
    })()

    if (!canAssign) {
      throw Object.assign(
        new Error(`Your role does not permit assigning the "${roleName}" role`),
        { statusCode: 403, code: 'INSUFFICIENT_ROLE' }
      )
    }

    // Resolve role ID
    const roleRows = await this.app.db.unsafe(
      `SELECT id FROM roles WHERE name = $1`,
      [roleName]
    )
    if (!roleRows[0]) {
      throw Object.assign(
        new Error(`Role "${roleName}" does not exist`),
        { statusCode: 400, code: 'INVALID_ROLE' }
      )
    }
    const roleId = (roleRows[0] as any).id

    // Clear individual scope grants — role defines access from scratch
    await this.app.db.unsafe(
      `DELETE FROM member_scopes WHERE member_id = $1`,
      [targetMemberId]
    )

    // Assign the new role
    await this.app.db.unsafe(
      `UPDATE members SET role_id = $1, updated_at = NOW() WHERE id = $2`,
      [roleId, targetMemberId]
    )

    // Revoke refresh tokens — forces re-login with updated role scopes
    await this.revokeRefreshTokens(targetMemberId)
  }

  // ── Member scope grants ────────────────────────────────────────────

  async getMemberScopes(memberId: string): Promise<MemberScopeRow[]> {
    const rows = await this.app.db.unsafe(
      `SELECT ms.scope_id, s.name, s.description, s.is_global,
              ms.granted_by, ms.granted_at
       FROM member_scopes ms
       JOIN scopes s ON s.id = ms.scope_id
       WHERE ms.member_id = $1
         AND s.is_archived = FALSE
       ORDER BY s.name ASC`,
      [memberId]
    )
    return rows as unknown as MemberScopeRow[]
  }

  /**
   * Grant additional scopes to a member.
   *
   * Transition logic:
   *   - If the scope is already in the member's current role set → no-op
   *   - If the scope is outside the role set → extension detected
   *   - On any extension:
   *       1. Copy current role's scopes into member_scopes as baseline
   *       2. Add the new scopes
   *       3. Transition member to 'custom' role
   *   - Refresh tokens are revoked after any change
   *
   * Caller rules:
   *   - superadmin can grant any non-archived scope
   *   - admin can only grant scopes in ADMIN_GRANTABLE_SCOPES
   *   - operator and below cannot grant scopes
   */
  async grantScopes(data: {
    targetMemberId: string
    scopeNames: string[]
    grantedById: string
    callerRole: string
  }): Promise<void> {
    const { targetMemberId, scopeNames, grantedById, callerRole } = data

    const isSuperAdmin = callerRole === 'superadmin'
    const isAdmin      = callerRole === 'admin'

    if (!isSuperAdmin && !isAdmin) {
      throw Object.assign(
        new Error('Only admins and superadmins can grant scopes'),
        { statusCode: 403, code: 'INSUFFICIENT_ROLE' }
      )
    }

    // Validate caller is permitted to grant each scope
    for (const scopeName of scopeNames) {
      if (!isSuperAdmin && !ADMIN_GRANTABLE_SCOPES.has(scopeName)) {
        throw Object.assign(
          new Error(`You do not have permission to grant the "${scopeName}" scope`),
          { statusCode: 403, code: 'SCOPE_GRANT_NOT_ALLOWED' }
        )
      }
    }

    // Validate all scopes exist and are not archived
    const scopeRows = await this.app.db.unsafe(
      `SELECT id, name FROM scopes
       WHERE name = ANY($1::text[]) AND is_archived = FALSE`,
      [scopeNames]
    )

    const foundNames = (scopeRows as any[]).map((r) => r.name as string)
    const missing    = scopeNames.filter((n) => !foundNames.includes(n))
    if (missing.length > 0) {
      throw Object.assign(
        new Error(`Unknown or archived scopes: ${missing.join(', ')}`),
        { statusCode: 400, code: 'UNKNOWN_SCOPE' }
      )
    }

    // Fetch the member's current role and its scope set
    const memberRows = await this.app.db.unsafe(
      `SELECT m.id, r.name as role_name, r.id as role_id
       FROM members m
       LEFT JOIN roles r ON r.id = m.role_id
       WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [targetMemberId]
    )

    if (!memberRows[0]) {
      throw Object.assign(
        new Error('Member not found'),
        { statusCode: 404, code: 'MEMBER_NOT_FOUND' }
      )
    }

    const currentRole   = (memberRows[0] as any).role_name as string
    const currentRoleId = (memberRows[0] as any).role_id as string

    // Fetch the scope IDs that belong to the current role
    const roleScopeRows = await this.app.db.unsafe(
      `SELECT scope_id FROM role_scopes WHERE role_id = $1`,
      [currentRoleId]
    )
    const roleScopeIds = new Set(
      (roleScopeRows as any[]).map((r) => r.scope_id as string)
    )

    // Determine which scopes being granted are outside the current role
    const extensionScopes = (scopeRows as any[]).filter(
      (r) => !roleScopeIds.has(r.id)
    )

    const hasExtensions = extensionScopes.length > 0

    // If extensions exist and member is not already custom — transition
    if (hasExtensions && currentRole !== 'custom') {
      await this.transitionToCustom(targetMemberId, currentRoleId, grantedById)
    }

    // Insert the new scope grants — skip duplicates
    for (const row of scopeRows as any[]) {
      await this.app.db.unsafe(
        `INSERT INTO member_scopes (member_id, scope_id, granted_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (member_id, scope_id) DO NOTHING`,
        [targetMemberId, row.id, grantedById]
      )
    }

    // Revoke refresh tokens — forces re-login with updated scopes
    await this.revokeRefreshTokens(targetMemberId)
  }

  /**
   * Revoke a scope from a member.
   * Superadmin only.
   * Refresh tokens revoked so the change takes effect within 15 minutes.
   */
  async revokeScope(data: {
    targetMemberId: string
    scopeId: string
    callerRole: string
  }): Promise<void> {
    const { targetMemberId, scopeId, callerRole } = data

    if (callerRole !== 'superadmin') {
      throw Object.assign(
        new Error('Only superadmins can revoke scopes'),
        { statusCode: 403, code: 'INSUFFICIENT_ROLE' }
      )
    }

    await this.app.db.unsafe(
      `DELETE FROM member_scopes WHERE member_id = $1 AND scope_id = $2`,
      [targetMemberId, scopeId]
    )

    await this.revokeRefreshTokens(targetMemberId)
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Transitions a member to the custom role.
   *
   * Process:
   *   1. Copy all current role scopes into member_scopes as the baseline
   *   2. Update member's role_id to the custom role
   *
   * The member retains all their existing access — the role scopes
   * become explicit individual grants so nothing is lost.
   */
  private async transitionToCustom(
    memberId: string,
    currentRoleId: string,
    grantedById: string
  ): Promise<void> {
    // Copy current role scopes into member_scopes as baseline
    await this.app.db.unsafe(
      `INSERT INTO member_scopes (member_id, scope_id, granted_by)
       SELECT $1, rs.scope_id, $2
       FROM role_scopes rs
       WHERE rs.role_id = $3
       ON CONFLICT (member_id, scope_id) DO NOTHING`,
      [memberId, grantedById, currentRoleId]
    )

    // Assign custom role
    await this.app.db.unsafe(
      `UPDATE members
       SET role_id = (SELECT id FROM roles WHERE name = 'custom'),
           updated_at = NOW()
       WHERE id = $1`,
      [memberId]
    )
  }

  private async revokeRefreshTokens(memberId: string): Promise<void> {
    await this.app.db.unsafe(
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE member_id = $1 AND revoked_at IS NULL`,
      [memberId]
    )
  }
}