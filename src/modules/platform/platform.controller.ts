import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PlatformService } from './platform.service';

@ApiTags('Platform')
@Controller('platform')
export class PlatformController {
  constructor(private platformService: PlatformService) {}

  @Get('stats')
  @Public()
  @UseInterceptors(CacheInterceptor)
  @CacheKey('platform:stats')
  @CacheTTL(300)
  @ApiOperation({
    summary: 'Get platform statistics',
    description:
      'Returns public platform-wide statistics. No authentication required. ' +
      'Cached for 5 minutes.',
  })
  @ApiOkResponse({
    description: 'Platform statistics',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            totalUsers: { type: 'integer', example: 10000 },
            activeCampaigns: { type: 'integer', example: 150 },
            completedVisits: { type: 'integer', example: 500000 },
            totalPaidOut: { type: 'integer', description: 'Total paid out across all users in kobo', example: 50000000000 },
          },
        },
      },
    },
  })
  getStats() {
    return this.platformService.getStats();
  }

  @Get('config')
  @Public()
  @UseInterceptors(CacheInterceptor)
  @CacheKey('platform:config')
  @CacheTTL(3600)
  @ApiOperation({
    summary: 'Get platform configuration',
    description:
      'Returns public platform config (pricing tiers, minimums, durations, referral bonus). ' +
      'No authentication required. Cached for 1 hour.',
  })
  @ApiOkResponse({
    description: 'Platform configuration',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            pricingTiers: {
              type: 'object',
              properties: {
                ECONOMY: {
                  type: 'object',
                  properties: {
                    payPerVisit: { type: 'integer', example: 5000 },
                    label: { type: 'string', example: 'Economy' },
                  },
                },
                STANDARD: {
                  type: 'object',
                  properties: {
                    payPerVisit: { type: 'integer', example: 10000 },
                    label: { type: 'string', example: 'Standard' },
                  },
                },
                PREMIUM: {
                  type: 'object',
                  properties: {
                    payPerVisit: { type: 'integer', example: 20000 },
                    label: { type: 'string', example: 'Premium' },
                  },
                },
              },
            },
            minDeposit: { type: 'integer', description: 'In kobo', example: 1500000 },
            minWithdrawal: { type: 'integer', description: 'In kobo', example: 500000 },
            durations: { type: 'array', items: { type: 'integer' }, example: [30, 60, 120, 180, 300] },
            referralBonusPerMilestone: { type: 'integer', description: 'In kobo', example: 375000 },
          },
        },
      },
    },
  })
  getConfig() {
    return this.platformService.getConfig();
  }
}
