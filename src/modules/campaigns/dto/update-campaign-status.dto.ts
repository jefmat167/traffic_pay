import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateCampaignStatusDto {
  @IsEnum(['approve', 'reject'] as const)
  action: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  reason?: string;
}
