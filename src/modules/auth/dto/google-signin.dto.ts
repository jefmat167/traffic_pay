import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleSignInDto {
  @ApiProperty({
    description: 'Google OAuth2 ID token obtained from client-side sign-in',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiPropertyOptional({
    description: 'Referral code of the user who referred this new user',
    example: 'JOHN1234',
  })
  @IsOptional()
  @IsString()
  referralCode?: string;
}
