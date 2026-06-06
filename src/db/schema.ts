/**
 * Database schema definitions.
 * Single source of truth for all table structures.
 *
 * Three exports:
 *   CREATE_TABLES — all DDL, run first
 *   SEED_DATA     — roles, scopes, role_scopes, run after tables exist
 *   SEED_ADMIN    — superadmin assignment, run after member is registered
 */

// ── CREATE_TABLES ──────────────────────────────────────────────────────────────
// Table order matters — referenced tables must be defined before foreign keys.
// scopes is defined before role_scopes because role_scopes references scopes(id).
// roles is defined before members because members references roles(id).

export const CREATE_TABLES = `
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  -- Organisational hierarchy

  CREATE TABLE IF NOT EXISTS installations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    code        TEXT NOT NULL UNIQUE,
    timezone    TEXT NOT NULL DEFAULT 'UTC',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
  );

  CREATE INDEX IF NOT EXISTS idx_installations_active
    ON installations(is_active);

  CREATE TABLE IF NOT EXISTS nations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    installation_id  UUID NOT NULL REFERENCES installations(id) ON DELETE RESTRICT,
    name             TEXT NOT NULL,
    description      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_nations_installation_name
    ON nations(installation_id, name);

  CREATE INDEX IF NOT EXISTS idx_nations_active
    ON nations(is_active);

  CREATE TABLE IF NOT EXISTS tribes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nation_id   UUID NOT NULL REFERENCES nations(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_tribes_nation_name
    ON tribes(nation_id, name);

  CREATE INDEX IF NOT EXISTS idx_tribes_active
    ON tribes(is_active);

  CREATE TABLE IF NOT EXISTS workforce_teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
  );

  CREATE INDEX IF NOT EXISTS idx_workforce_teams_active
    ON workforce_teams(is_active);

  CREATE TABLE IF NOT EXISTS interest_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_interest_groups_active
    ON interest_groups(is_active);

  CREATE TABLE IF NOT EXISTS affinity_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_affinity_groups_active
    ON affinity_groups(is_active);

  -- Roles
  -- Defined before scopes and members so foreign keys resolve correctly

  CREATE TABLE IF NOT EXISTS roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE
                  CHECK (name IN ('superadmin', 'admin', 'operator', 'user', 'custom')),
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Access control
  -- scopes defined before role_scopes because role_scopes references scopes(id)

  CREATE TABLE IF NOT EXISTS scopes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    is_global   BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE scopes
    ADD COLUMN IF NOT EXISTS is_global   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

  -- Role scopes
  -- Defined after both roles and scopes

  CREATE TABLE IF NOT EXISTS role_scopes (
    role_id   UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    scope_id  UUID NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, scope_id)
  );

  -- Members
  -- Defined after roles so role_id foreign key resolves

  CREATE TABLE IF NOT EXISTS members (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tribe_id          UUID REFERENCES tribes(id) ON DELETE RESTRICT,
    workforce_team_id UUID REFERENCES workforce_teams(id) ON DELETE RESTRICT,
    role_id           UUID REFERENCES roles(id) ON DELETE RESTRICT,
    first_name        TEXT NOT NULL,
    last_name         TEXT NOT NULL,
    email             TEXT NOT NULL UNIQUE,
    phone             TEXT,
    address           TEXT,
    date_of_birth     DATE,
    password_hash     TEXT,
    status            TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive', 'suspended')),
    is_migrated       BOOLEAN NOT NULL DEFAULT TRUE,
    migrated_at       TIMESTAMPTZ,
    placement_complete  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_members_email
    ON members(email) WHERE deleted_at IS NULL;

  CREATE INDEX IF NOT EXISTS idx_members_tribe
    ON members(tribe_id) WHERE deleted_at IS NULL;

  CREATE INDEX IF NOT EXISTS idx_members_name
    ON members(last_name, first_name) WHERE deleted_at IS NULL;

  ALTER TABLE members
    ADD COLUMN IF NOT EXISTS role_id            UUID REFERENCES roles(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS installation_id    UUID REFERENCES installations(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS nation_id          UUID REFERENCES nations(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS placement_complete BOOLEAN NOT NULL DEFAULT FALSE;

  ALTER TABLE members
    DROP COLUMN IF EXISTS photo_url;

  -- Social identities

  CREATE TABLE IF NOT EXISTS member_identities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id   UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL CHECK (provider IN ('google', 'apple', 'facebook')),
    provider_id TEXT NOT NULL,
    email       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider, provider_id)
  );

  -- Member scopes

  CREATE TABLE IF NOT EXISTS member_scopes (
    member_id  UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    scope_id   UUID NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES members(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (member_id, scope_id)
  );

  CREATE TABLE IF NOT EXISTS member_interest_groups (
    member_id         UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    interest_group_id UUID NOT NULL REFERENCES interest_groups(id) ON DELETE CASCADE,
    joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (member_id, interest_group_id)
  );

  CREATE TABLE IF NOT EXISTS member_affinity_groups (
    member_id         UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    affinity_group_id UUID NOT NULL REFERENCES affinity_groups(id) ON DELETE CASCADE,
    joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (member_id, affinity_group_id)
  );

  -- Sessions

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id  UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_member
    ON refresh_tokens(member_id);
`

// ── SEED_DATA ──────────────────────────────────────────────────────────────────
// Run after CREATE_TABLES completes.
// All tables referenced here are guaranteed to exist.

export const SEED_DATA = `
  -- Seed roles
  INSERT INTO roles (name, description) VALUES
    ('superadmin', 'Full privileges including delete and scope management'),
    ('admin',      'All privileges excluding delete'),
    ('operator',   'All privileges excluding delete and permission management'),
    ('user',       'Default role — read and checkin access'),
    ('custom',     'Bespoke permission set built from user baseline')
  ON CONFLICT (name) DO NOTHING;

  -- Seed scopes
  INSERT INTO scopes (name, description, is_global) VALUES
    ('org.installation.create', 'Create installations',         FALSE),
    ('org.installation.read',   'View installations',           FALSE),
    ('org.installation.delete', 'Delete installations',         FALSE),
    ('org.nation.create',       'Create nations',               FALSE),
    ('org.nation.read',         'View nations',                 FALSE),
    ('org.nation.delete',       'Delete nations',               FALSE),
    ('org.tribe.create',        'Create tribes',                FALSE),
    ('org.tribe.read',          'View tribes',                  FALSE),
    ('org.tribe.delete',        'Delete tribes',                FALSE),
    ('org.workforce.create',    'Create workforce teams',       FALSE),
    ('org.workforce.read',      'View workforce teams',         FALSE),
    ('org.workforce.delete',    'Delete workforce teams',       FALSE),
    ('members.profile.read',    'View member profiles',         FALSE),
    ('members.profile.write',   'Update member profiles',       FALSE),
    ('members.profile.delete',  'Delete member profiles',       FALSE),
    ('members.role.assign',     'Assign roles to members',      FALSE),
    ('members.scope.assign',    'Assign scopes to members',     FALSE),
    ('members.groups.assign',   'Assign members to groups',     FALSE),
    ('members.placement.update','Update member placement',      FALSE),
    ('checkin.attendance.write','Record attendance',            TRUE),
    ('checkin.attendance.read', 'View attendance records',      TRUE),
    ('groups.interest.create',  'Create interest groups',       FALSE),
    ('groups.interest.read',    'View interest groups',         FALSE),
    ('groups.interest.delete',  'Delete interest groups',       FALSE),
    ('groups.affinity.create',  'Create affinity groups',       FALSE),
    ('groups.affinity.read',    'View affinity groups',         FALSE),
    ('groups.affinity.delete',  'Delete affinity groups',       FALSE)
  ON CONFLICT (name) DO NOTHING;

  -- Seed role_scopes

  -- superadmin — everything
  INSERT INTO role_scopes (role_id, scope_id)
  SELECT r.id, s.id FROM roles r CROSS JOIN scopes s
  WHERE r.name = 'superadmin'
  ON CONFLICT DO NOTHING;

  -- admin — all except delete and permission management
  INSERT INTO role_scopes (role_id, scope_id)
  SELECT r.id, s.id FROM roles r
  JOIN scopes s ON s.name = ANY(ARRAY[
    'org.installation.create', 'org.installation.read',
    'org.nation.create',       'org.nation.read',
    'org.tribe.create',        'org.tribe.read',
    'org.workforce.create',    'org.workforce.read',
    'members.profile.read',    'members.profile.write',
    'members.role.assign',
    'checkin.attendance.write','checkin.attendance.read',
    'groups.interest.read',    'groups.affinity.read',
    'members.placement.update','members.groups.assign'
  ])
  WHERE r.name = 'admin'
  ON CONFLICT DO NOTHING;

  -- operator — all except delete and permission management
  INSERT INTO role_scopes (role_id, scope_id)
  SELECT r.id, s.id FROM roles r
  JOIN scopes s ON s.name = ANY(ARRAY[
    'org.installation.create', 'org.installation.read',
    'org.nation.create',       'org.nation.read',
    'org.tribe.create',        'org.tribe.read',
    'org.workforce.create',    'org.workforce.read',
    'members.profile.read',    'members.profile.write',
    'checkin.attendance.write','checkin.attendance.read',
    'groups.interest.read',    'groups.affinity.read'
  ])
  WHERE r.name = 'operator'
  ON CONFLICT DO NOTHING;

  -- user — default, read + checkin
  INSERT INTO role_scopes (role_id, scope_id)
  SELECT r.id, s.id FROM roles r
  JOIN scopes s ON s.name = ANY(ARRAY[
    'members.profile.read',
    'checkin.attendance.write',
    'checkin.attendance.read'
  ])
  WHERE r.name = 'user'
  ON CONFLICT DO NOTHING;

  -- custom — no default scopes, built individually per member
`

// ── SEED_ADMIN ─────────────────────────────────────────────────────────────────
// Run after SEED_DATA completes.
// Assigns superadmin role to the member matching ADMIN_EMAIL.
// Safe to run multiple times — UPDATE is idempotent.
// If the member does not exist yet, register first then re-run pnpm db:migrate.

export const SEED_ADMIN = (adminEmail: string): string => `
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM members
      WHERE email = '${adminEmail}'
        AND deleted_at IS NULL
    ) THEN
      UPDATE members
      SET role_id = (SELECT id FROM roles WHERE name = 'superadmin')
      WHERE email = '${adminEmail}';

      RAISE NOTICE 'Superadmin role assigned to ${adminEmail}';
    ELSE
      RAISE NOTICE 'Member ${adminEmail} not found — register first then re-run pnpm db:migrate';
    END IF;
  END $$;
`