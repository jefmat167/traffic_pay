import { IsEnum, IsIn, IsInt, IsString, IsUrl, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CampaignType, PricingTier } from '../../../common/enums';

export class CreateCampaignDto {
  @ApiProperty({
    description: 'Campaign display name',
    example: 'My Awesome Blog Post',
    maxLength: 100,
  })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Target URL users will visit',
    example: 'https://myblog.com/awesome-post',
  })
  @IsUrl()
  url: string;

  @ApiProperty({
    description: 'Campaign description shown to users',
    example: 'Read and engage with this blog post about tech trends',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Type of campaign content',
    enum: CampaignType,
    example: CampaignType.BLOG,
  })
  @IsEnum(CampaignType)
  campaignType: CampaignType;

  @ApiProperty({
    description: 'Minimum visit duration in seconds. Allowed values: 30, 60, 120, 180, 300',
    enum: [30, 60, 120, 180, 300],
    example: 60,
  })
  @IsIn([30, 60, 120, 180, 300])
  minDuration: number;

  @ApiProperty({
    description: 'Total number of visits to purchase',
    example: 100,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  totalVisits: number;

  @ApiProperty({
    description: 'Pricing tier determining pay-per-visit rate. Economy=50 NGN, Standard=100 NGN, Premium=200 NGN',
    enum: PricingTier,
    example: PricingTier.STANDARD,
  })
  @IsEnum(PricingTier)
  pricingTier: PricingTier;

  @ApiProperty({
    description: 'Total campaign budget in kobo (must be >= totalVisits * payPerVisit). Minimum 1,500,000 kobo (15,000 NGN)',
    example: 1500000,
    minimum: 1500000,
  })
  @IsInt()
  @Min(1500000)
  budget: number;
}
