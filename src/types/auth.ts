/**
 * Shared auth types used across services and routes.
 */

export type OAuthProvider = 'google' | 'apple' | 'facebook' | 'microsoft'

export interface JwtPayload {
  sub: string           // member id
  email: string
  role: string
  org: {
    installation_id: string | null
    nation_id: string | null
    tribe_id: string | null
    workforce_team_id: string | null
  }
  scopes: string[]
  iat?: number
  exp?: number
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface MigrationRequiredResponse {
  status: 'migration_required'
  message: string
  migrationToken: string
  options: OAuthProvider[]
}

export interface OAuthProfile {
  providerId: string
  email: string
  firstName: string
  lastName: string
}
