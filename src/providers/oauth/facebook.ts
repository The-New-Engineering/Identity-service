import { Facebook } from 'arctic'
import type { IOAuthProvider } from './interface'
import type { OAuthProfile } from '../../types/auth'

export class FacebookProvider implements IOAuthProvider {
  name = 'facebook'
  constructor(private clientId: string, private clientSecret: string) {}

  async getAuthUrl(state: string, redirectUri: string): Promise<string> {
    const client = new Facebook(this.clientId, this.clientSecret, redirectUri)
    const url = await client.createAuthorizationURL(state, { scopes: ['email', 'public_profile'] })
    return url.toString()
  }

  async exchangeCode(code: string, _redirectUri: string): Promise<OAuthProfile> {
    const client = new Facebook(this.clientId, this.clientSecret, _redirectUri)
    const tokens = await client.validateAuthorizationCode(code)

    const response = await fetch(
      `https://graph.facebook.com/me?fields=id,email,first_name,last_name&access_token=${tokens.accessToken}`
    )
    if (!response.ok) throw new Error('Failed to fetch Facebook profile')

    const profile = await response.json() as {
      id: string; email: string; first_name: string; last_name?: string
    }

    return {
      providerId: profile.id,
      email: profile.email,
      firstName: profile.first_name,
      lastName: profile.last_name ?? '',
    }
  }
}
