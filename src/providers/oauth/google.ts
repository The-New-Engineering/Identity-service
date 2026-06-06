import { Google, generateCodeVerifier } from 'arctic'
import type { IOAuthProvider } from './interface'
import type { OAuthProfile } from '../../types/auth'
import type Redis from 'ioredis'

export class GoogleProvider implements IOAuthProvider {
  name = 'google'

  constructor(
    private clientId: string,
    private clientSecret: string,
    private cache: Redis
  ) {}

  async getAuthUrl(state: string, redirectUri: string): Promise<string> {
    const client = new Google(this.clientId, this.clientSecret, redirectUri)
    const codeVerifier = generateCodeVerifier()

    // Store codeVerifier in Redis keyed by state — expires in 10 minutes
    // Must survive until the callback comes back from Google
    await this.cache.set(`oauth_cv:${state}`, codeVerifier, 'EX', 600)

    const url = await client.createAuthorizationURL(state, codeVerifier, {
      scopes: ['openid', 'email', 'profile'],
    })

    return url.toString()
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
    state?: string
  ): Promise<OAuthProfile> {
    if (!state) {
      throw Object.assign(
        new Error('State is required for Google OAuth'),
        { statusCode: 400, code: 'MISSING_STATE' }
      )
    }

    // Retrieve and immediately delete codeVerifier — single use
    const codeVerifier = await this.cache.get(`oauth_cv:${state}`)
    if (!codeVerifier) {
      throw Object.assign(
        new Error('OAuth session expired or invalid — please try logging in again'),
        { statusCode: 400, code: 'INVALID_OAUTH_STATE' }
      )
    }
    await this.cache.del(`oauth_cv:${state}`)

    const client = new Google(this.clientId, this.clientSecret, redirectUri)
    const tokens = await client.validateAuthorizationCode(code, codeVerifier)

    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })
    if (!response.ok) throw new Error('Failed to fetch Google profile')

    const profile = await response.json() as {
      sub: string
      email: string
      given_name: string
      family_name?: string
    }

    return {
      providerId: profile.sub,
      email: profile.email,
      firstName: profile.given_name,
      lastName: profile.family_name ?? '',
    }
  }
}