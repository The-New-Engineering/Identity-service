import type { OAuthProfile } from '../../types/auth'

export interface IOAuthProvider {
  name: string
  getAuthUrl(state: string, redirectUri: string): Promise<string>
  exchangeCode(code: string, redirectUri: string, state?: string): Promise<OAuthProfile>
}