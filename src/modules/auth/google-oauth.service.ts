import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class GoogleOAuthService {
  private client: OAuth2Client;

  constructor(private config: ConfigService) {
    this.client = new OAuth2Client(this.config.get('googleClientId'));
  }

  async verifyIdToken(idToken: string) {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.config.get('googleClientId'),
      });
      const payload = ticket.getPayload();
      if (!payload) throw new UnauthorizedException('Invalid Google token');
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }
  }
}
