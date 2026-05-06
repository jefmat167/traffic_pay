import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewCampaignDto {
  @ApiProperty({
    description: 'Review action to take on the campaign',
    enum: ['approve', 'reject'],
    example: 'approve',
  })
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';

  @ApiPropertyOptional({
    description: 'Reason for rejection (required when action is "reject")',
    example: 'Campaign URL leads to inappropriate content',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
