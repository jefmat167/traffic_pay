import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BlockUserDto {
  @ApiProperty({
    description: 'Whether to block (true) or unblock (false) the user',
    example: true,
  })
  @IsBoolean()
  isBlocked: boolean;

  @ApiPropertyOptional({
    description: 'Reason for blocking the user',
    example: 'Fraudulent activity detected',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
