import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { RefreshToken } from './entities/refresh-token.entity';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleSignInDto } from './dto/google-signin.dto';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { ReferralsService } from '../referrals/referrals.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(RefreshToken)
    private refreshTokenRepo: Repository<RefreshToken>,
    private jwtService: JwtService,
    private googleOAuthService: GoogleOAuthService,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    @Inject(forwardRef(() => WalletService))
    private walletService: WalletService,
    @Inject(forwardRef(() => ReferralsService))
    private referralsService: ReferralsService,
    private config: ConfigService,
  ) {}

  async googleSignIn(dto: GoogleSignInDto) {
    const googlePayload = await this.googleOAuthService.verifyIdToken(
      dto.idToken,
    );

    let user = await this.usersService.findByGoogleId(googlePayload.sub);
    let isNewUser = false;

    if (!user) {
      isNewUser = true;

      // Validate referral code if provided
      let referrerId: string | undefined;
      if (dto.referralCode) {
        const referrer = await this.usersService.findByReferralCode(dto.referralCode);
        if (!referrer) {
          throw new BadRequestException({ code: 'INVALID_REFERRAL_CODE', message: 'Invalid referral code.' });
        }
        referrerId = referrer.id;
      }

      const referralCode = await this.generateUniqueReferralCode(
        googlePayload.name || 'USER',
      );

      user = await this.usersService.create({
        googleId: googlePayload.sub,
        email: googlePayload.email!,
        fullName: googlePayload.name || '',
        avatarUrl: googlePayload.picture,
        referralCode,
        referredById: referrerId,
      });

      await this.walletService.createWallet(user.id);

      if (referrerId) {
        await this.referralsService.createReferralRecord(referrerId, user.id);
      }
    }

    if (user.isBlocked) {
      throw new ForbiddenException(
        user.blockedReason || 'Account is blocked',
      );
    }

    const tokens = await this.issueTokenPair(user);

    return { ...tokens, isNewUser };
  }

  async refreshTokens(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);

    const storedToken = await this.refreshTokenRepo.findOne({
      where: { tokenHash },
      relations: ['user'],
    });

    if (!storedToken || storedToken.isRevoked) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Revoke the old token (rotation)
    storedToken.isRevoked = true;
    await this.refreshTokenRepo.save(storedToken);

    if (storedToken.user.isBlocked) {
      throw new ForbiddenException(
        storedToken.user.blockedReason || 'Account is blocked',
      );
    }

    return this.issueTokenPair(storedToken.user);
  }

  async logout(userId: string, rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);

    await this.refreshTokenRepo.update(
      { userId, tokenHash },
      { isRevoked: true },
    );
  }

  async revokeAllUserSessions(userId: string) {
    await this.refreshTokenRepo.update(
      { userId, isRevoked: false },
      { isRevoked: true },
    );
  }

  private async issueTokenPair(user: User) {
    const accessToken = this.jwtService.sign({
      sub: user.id,
      role: user.role,
    });

    const rawRefreshToken = nanoid(64);
    const tokenHash = this.hashToken(rawRefreshToken);

    const refreshExpiry = this.config.get<string>('jwt.refreshExpiry') || '30d';
    const expiresAt = new Date();
    const days = parseInt(refreshExpiry, 10) || 30;
    expiresAt.setDate(expiresAt.getDate() + days);

    const refreshToken = this.refreshTokenRepo.create({
      userId: user.id,
      tokenHash,
      expiresAt,
    });
    await this.refreshTokenRepo.save(refreshToken);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async generateUniqueReferralCode(name: string): Promise<string> {
    const baseName = name
      .replace(/[^a-zA-Z]/g, '')
      .substring(0, 4)
      .toUpperCase();

    const prefix = baseName || 'USER';

    for (let i = 0; i < 10; i++) {
      const suffix = Math.floor(1000 + Math.random() * 9000).toString();
      const code = `${prefix}${suffix}`;
      const exists = await this.usersService.findByReferralCode(code);
      if (!exists) return code;
    }

    // Fallback to nanoid-based code
    return nanoid(8).toUpperCase();
  }
}
