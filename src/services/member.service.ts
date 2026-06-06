import bcrypt from 'bcryptjs'
import type { FastifyInstance } from 'fastify'

const BCRYPT_ROUNDS = 12

export interface MemberRow {
  id: string
  tribe_id: string | null
  nation_id: string | null
  installation_id: string | null
  workforce_team_id: string | null
  role_id: string | null
  email: string
  password_hash: string | null
  first_name: string
  last_name: string
  phone: string | null
  address: string | null
  date_of_birth: string | null
  status: string
  is_migrated: boolean
  migrated_at: Date | null
  placement_complete: boolean
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
  // Joined fields
  installation_code: string | null
  installation_name: string | null
  nation_name: string | null
  tribe_name: string | null
  workforce_team_name: string | null
  role_name: string | null
}

const MEMBER_SELECT = `
  SELECT
    m.id, m.tribe_id, m.nation_id, m.installation_id,
    m.workforce_team_id, m.role_id,
    m.email, m.password_hash,
    m.first_name, m.last_name,
    m.phone, m.address, m.date_of_birth,
    m.status, m.is_migrated, m.migrated_at,
    m.placement_complete,
    m.created_at, m.updated_at, m.deleted_at,
    i.code  AS installation_code,
    i.name  AS installation_name,
    n.name  AS nation_name,
    t.name  AS tribe_name,
    wt.name AS workforce_team_name,
    r.name  AS role_name
  FROM members m
  LEFT JOIN installations i  ON i.id = m.installation_id
  LEFT JOIN nations n        ON n.id = m.nation_id
  LEFT JOIN tribes t         ON t.id = m.tribe_id
  LEFT JOIN workforce_teams wt ON wt.id = m.workforce_team_id
  LEFT JOIN roles r          ON r.id = m.role_id
`

export class MemberService {
  constructor(private app: FastifyInstance) {}

  async findByEmail(email: string): Promise<MemberRow | null> {
    const rows = await this.app.db.unsafe(
      `${MEMBER_SELECT} WHERE m.email = $1 AND m.deleted_at IS NULL LIMIT 1`,
      [email.toLowerCase()]
    )
    return (rows[0] as unknown as MemberRow) ?? null
  }

  async findById(id: string): Promise<MemberRow | null> {
    const rows = await this.app.db.unsafe(
      `${MEMBER_SELECT} WHERE m.id = $1 AND m.deleted_at IS NULL LIMIT 1`,
      [id]
    )
    return (rows[0] as unknown as MemberRow) ?? null
  }

  async create(data: {
    email: string
    password: string
    firstName: string
    lastName: string
    installationId: string       // required — enforced at route level
    nationId?: string
    tribeId?: string
    workforceTeamId?: string
    phone?: string
    address?: string
    dateOfBirth?: string
  }): Promise<MemberRow> {
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS)

    const rows = await this.app.db.unsafe(
      `INSERT INTO members (
        email, password_hash,
        first_name, last_name,
        phone, address, date_of_birth,
        installation_id, nation_id, tribe_id, workforce_team_id,
        placement_complete,
        is_migrated, role_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE,
        (SELECT id FROM roles WHERE name = 'user')
      )
      RETURNING *`,
      [
        data.email.toLowerCase(),
        passwordHash,
        data.firstName,
        data.lastName,
        data.phone          ?? null,
        data.address        ?? null,
        data.dateOfBirth    ?? null,
        data.installationId,
        data.nationId       ?? null,
        data.tribeId        ?? null,
        data.workforceTeamId ?? null,
        true,                          // placement_complete — installation is set
      ]
    )

  // Re-fetch with full joins to return complete context
  return this.findById((rows[0] as any).id) as Promise<MemberRow>
}

 async findOrCreateFromOAuth(
    provider: string,
    providerId: string,
    email: string,
    firstName: string,
    lastName: string,
    installationId?: string    // passed from OAuth state if available
  ): Promise<MemberRow> {
    // Check if identity already linked
    const identityRows = await this.app.db.unsafe(
      `SELECT member_id FROM member_identities
      WHERE provider = $1 AND provider_id = $2`,
      [provider, providerId]
    )

    if (identityRows[0]) {
      const member = await this.findById((identityRows[0] as any).member_id)
      if (!member) throw new Error('MEMBER_NOT_FOUND')
      return member
    }

    // Check if member exists by email — link identity if so
    let member = await this.findByEmail(email)

    if (!member) {
      const rows = await this.app.db.unsafe(
        `INSERT INTO members (
          email, first_name, last_name,
          phone, address, date_of_birth,
          installation_id, placement_complete,
          is_migrated, role_id
        )
        VALUES ($1, $2, $3, NULL, NULL, NULL,
          $4, $5, TRUE,
          (SELECT id FROM roles WHERE name = 'user')
        )
        RETURNING id`,
        [
          email.toLowerCase(),
          firstName,
          lastName,
          installationId ?? null,
          installationId ? true : false,   // placement_complete only if installation provided
        ]
      )
      member = await this.findById((rows[0] as any).id) as MemberRow
    }

    await this.app.db.unsafe(
      `INSERT INTO member_identities (member_id, provider, provider_id, email)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (provider, provider_id) DO NOTHING`,
      [member.id, provider, providerId, email.toLowerCase()]
    )

    return member
  }

  async verifyPassword(member: MemberRow, password: string): Promise<boolean> {
    if (!member.password_hash) return false
    return bcrypt.compare(password, member.password_hash)
  }

  async setPassword(memberId: string, password: string): Promise<void> {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    await this.app.db.unsafe(
      `UPDATE members
       SET password_hash = $1, is_migrated = TRUE, migrated_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [hash, memberId]
    )
  }

  async markMigrated(memberId: string): Promise<void> {
    await this.app.db.unsafe(
      `UPDATE members SET is_migrated = TRUE, migrated_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [memberId]
    )
  }

  async updatePlacement(
    memberId: string,
    data: {
      installationId?: string
      nationId?: string
      tribeId?: string
      workforceTeamId?: string
    }
  ): Promise<MemberRow | null> {
    const updates: string[] = []
    const values: any[]     = []
    let   paramIndex        = 1

    if (data.installationId  !== undefined) {
      updates.push(`installation_id = $${paramIndex++}`)
      values.push(data.installationId)
    }
    if (data.nationId !== undefined) {
      updates.push(`nation_id = $${paramIndex++}`)
      values.push(data.nationId)
    }
    if (data.tribeId !== undefined) {
      updates.push(`tribe_id = $${paramIndex++}`)
      values.push(data.tribeId)
    }
    if (data.workforceTeamId !== undefined) {
      updates.push(`workforce_team_id = $${paramIndex++}`)
      values.push(data.workforceTeamId)
    }

    if (updates.length === 0) return this.findById(memberId)

    // placement_complete is true when installation_id is set
    updates.push(`
      placement_complete = CASE
        WHEN installation_id IS NOT NULL THEN TRUE
        ELSE FALSE
      END
    `)
    updates.push(`updated_at = NOW()`)
    values.push(memberId)

    await this.app.db.unsafe(
      `UPDATE members
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
        AND deleted_at IS NULL`,
      values
    )

    return this.findById(memberId)
  }

  async update(memberId: string, data: {
    firstName?: string
    lastName?: string
    phone?: string
    address?: string
    dateOfBirth?: string
    photoUrl?: string
  }): Promise<MemberRow | null> {
    // Build SET clause dynamically — only update provided fields
    const updates: string[] = []
    const values: any[]     = []
    let   paramIndex        = 1

    if (data.firstName   !== undefined) { updates.push(`first_name = $${paramIndex++}`);    values.push(data.firstName) }
    if (data.lastName    !== undefined) { updates.push(`last_name = $${paramIndex++}`);     values.push(data.lastName) }
    if (data.phone       !== undefined) { updates.push(`phone = $${paramIndex++}`);         values.push(data.phone) }
    if (data.address     !== undefined) { updates.push(`address = $${paramIndex++}`);       values.push(data.address) }
    if (data.dateOfBirth !== undefined) { updates.push(`date_of_birth = $${paramIndex++}`); values.push(data.dateOfBirth) }
    if (data.photoUrl    !== undefined) { updates.push(`photo_url = $${paramIndex++}`);     values.push(data.photoUrl) }

    if (updates.length === 0) return this.findById(memberId)

    updates.push(`updated_at = NOW()`)
    values.push(memberId)

    const rows = await this.app.db.unsafe(
      `UPDATE members
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
        AND deleted_at IS NULL
      RETURNING id, tribe_id, workforce_team_id, role_id, email, password_hash,
                first_name, last_name, phone, address, date_of_birth, photo_url,
                status, is_migrated, migrated_at`,
      values
    )

    if (!rows[0]) return null

    // Re-fetch with joined fields (nation_id, installation_id)
    return this.findById(memberId)
  }

  async listMembers(filters: {
    installationId?: string
    nationId?: string
    tribeId?: string
    workforceTeamId?: string
    status?: string
    limit?: number
    offset?: number
  }): Promise<{ members: MemberRow[]; total: number }> {
    const conditions: string[] = ['m.deleted_at IS NULL']
    const values: any[]        = []
    let   paramIndex           = 1

    if (filters.installationId) {
      conditions.push(`m.installation_id = $${paramIndex++}`)
      values.push(filters.installationId)
    }
    if (filters.nationId) {
      conditions.push(`m.nation_id = $${paramIndex++}`)
      values.push(filters.nationId)
    }
    if (filters.tribeId) {
      conditions.push(`m.tribe_id = $${paramIndex++}`)
      values.push(filters.tribeId)
    }
    if (filters.workforceTeamId) {
      conditions.push(`m.workforce_team_id = $${paramIndex++}`)
      values.push(filters.workforceTeamId)
    }
    if (filters.status) {
      conditions.push(`m.status = $${paramIndex++}`)
      values.push(filters.status)
    }

    const where  = `WHERE ${conditions.join(' AND ')}`
    const limit  = filters.limit  ?? 20
    const offset = filters.offset ?? 0

    const [countResult, members] = await Promise.all([
      this.app.db.unsafe(
        `SELECT COUNT(*) as total
        FROM members m
        ${where}`,
        values
      ),
      this.app.db.unsafe(
        `${MEMBER_SELECT}
        ${where}
        ORDER BY m.last_name ASC, m.first_name ASC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        [...values, limit, offset]
      ),
    ])

    return {
      members: members as unknown as MemberRow[],
      total:   parseInt((countResult[0] as any).total, 10),
    }
  }

  // ── Interest groups ──────────────────────────────────────────────────

  async getMemberInterestGroups(memberId: string): Promise<any[]> {
    const rows = await this.app.db.unsafe(
      `SELECT ig.id, ig.name, ig.description, mig.joined_at
      FROM member_interest_groups mig
      JOIN interest_groups ig ON ig.id = mig.interest_group_id
      WHERE mig.member_id = $1
        AND ig.is_active = TRUE
      ORDER BY ig.name ASC`,
      [memberId]
    )
    return rows as any[]
  }

  async assignInterestGroups(
    memberId: string,
    groupIds: string[]
  ): Promise<void> {
    for (const groupId of groupIds) {
      await this.app.db.unsafe(
        `INSERT INTO member_interest_groups (member_id, interest_group_id)
        VALUES ($1, $2)
        ON CONFLICT (member_id, interest_group_id) DO NOTHING`,
        [memberId, groupId]
      )
    }
  }

  async removeInterestGroup(
    memberId: string,
    groupId: string
  ): Promise<void> {
    await this.app.db.unsafe(
      `DELETE FROM member_interest_groups
      WHERE member_id = $1 AND interest_group_id = $2`,
      [memberId, groupId]
    )
  }

  // ── Affinity groups ──────────────────────────────────────────────────

  async getMemberAffinityGroups(memberId: string): Promise<any[]> {
    const rows = await this.app.db.unsafe(
      `SELECT ag.id, ag.name, ag.description, mag.joined_at
      FROM member_affinity_groups mag
      JOIN affinity_groups ag ON ag.id = mag.affinity_group_id
      WHERE mag.member_id = $1
        AND ag.is_active = TRUE
      ORDER BY ag.name ASC`,
      [memberId]
    )
    return rows as any[]
  }

  async assignAffinityGroups(
    memberId: string,
    groupIds: string[]
  ): Promise<void> {
    for (const groupId of groupIds) {
      await this.app.db.unsafe(
        `INSERT INTO member_affinity_groups (member_id, affinity_group_id)
        VALUES ($1, $2)
        ON CONFLICT (member_id, affinity_group_id) DO NOTHING`,
        [memberId, groupId]
      )
    }
  }

  async removeAffinityGroup(
    memberId: string,
    groupId: string
  ): Promise<void> {
    await this.app.db.unsafe(
      `DELETE FROM member_affinity_groups
      WHERE member_id = $1 AND affinity_group_id = $2`,
      [memberId, groupId]
    )
  }

  buildOrgContext(member: MemberRow) {
    return {
      installation_id:   member.installation_id  ?? null,
      nation_id:         member.nation_id        ?? null,
      tribe_id:          member.tribe_id         ?? null,
      workforce_team_id: member.workforce_team_id ?? null,
    }
  }
}
