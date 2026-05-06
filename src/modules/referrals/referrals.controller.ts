import { Controller, Get } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ReferralsService } from './referrals.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('Referrals')
@ApiBearerAuth()
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get referral statistics',
    description:
      'Returns the total number of referrals and a list of all referees with their milestone status. ' +
      'Referee names are masked for privacy (e.g. "Chi***").',
  })
  @ApiOkResponse({
    description: 'Referral stats retrieved',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            totalReferrals: { type: 'integer', example: 5 },
            referrals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  refereeName: { type: 'string', description: 'Masked name', example: 'Chi***' },
                  milestone1Credited: { type: 'boolean', description: 'First deposit milestone', example: true },
                  milestone1CreditedAt: { type: 'string', format: 'date-time', nullable: true },
                  milestone2Credited: { type: 'boolean', description: '10 completed visits milestone', example: false },
                  milestone2CreditedAt: { type: 'string', format: 'date-time', nullable: true },
                  totalEarned: { type: 'integer', description: 'Total earned from this referral in kobo', example: 375000 },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  getReferralStats(@CurrentUser() user: User) {
    return this.referralsService.getReferralStats(user.id);
  }
}
