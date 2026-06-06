import { Apple } from 'arctic'
import type { IOAuthProvider } from './interface'
import type { OAuthProfile } from '../../types/auth'

export class AppleProvider implements IOAuthProvider {
  name = 'apple'
  constructor(
    private clientId: string,
    private teamId: string,
    private keyId: string,
    private privateKey: string,
  ) {}

  async getAuthUrl(state: string, redirectUri: string): Promise<string> {
    const client = new Apple(
      { clientId: this.clientId, teamId: this.teamId, keyId: this.keyId, certificate: this.privateKey },
      redirectUri
    )
    const url = await client.createAuthorizationURL(state, { scopes: ['email', 'name'] })
    return url.toString()
  }

  async exchangeCode(code: string, _redirectUri: string): Promise<OAuthProfile> {
    const client = new Apple(
      { clientId: this.clientId, teamId: this.teamId, keyId: this.keyId, certificate: this.privateKey },
      _redirectUri
    )
    const tokens = await client.validateAuthorizationCode(code)
    const payload = JSON.parse(
      Buffer.from(tokens.idToken.split('.')[1], 'base64url').toString()
    ) as { sub: string; email: string }

    return {
      providerId: payload.sub,
      email: payload.email,
      firstName: '',
      lastName: '',
    }
  }
}
