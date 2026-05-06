import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role, WithdrawalStatus } from '../../common/enums';
import { User } from '../users/entities/user.entity';
import { BlockUserDto } from './dto/block-user.dto';
import { ReviewCampaignDto } from './dto/review-campaign.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('users')
  @ApiOperation({
    summary: 'List all users',
    description: 'Admin-only. Returns a paginated list of all users. Supports search by email or name.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)', example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20)', example: 20 })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by email or full name (ILIKE)', example: 'chidera' })
  @ApiOkResponse({
    description: 'Paginated user list',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { type: 'object', description: 'User objects' } },
            total: { type: 'integer', example: 500 },
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  listUsers(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.adminService.listUsers({ page, limit, search });
  }

  @Patch('users/:id/block')
  @ApiOperation({
    summary: 'Block or unblock a user',
    description:
      'Admin-only. Blocks or unblocks a user. Blocking immediately revokes all refresh tokens, ' +
      'forcing the user to re-authenticate (which will fail due to the block).',
  })
  @ApiParam({ name: 'id', description: 'Target user UUID', format: 'uuid' })
  @ApiOkResponse({
    description: 'User block status updated',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            userId: { type: 'string', format: 'uuid' },
            isBlocked: { type: 'boolean', example: true },
            reason: { type: 'string', nullable: true, example: 'Fraudulent activity' },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  blockUser(
    @CurrentUser() admin: User,
    @Param('id') userId: string,
    @Body() dto: BlockUserDto,
  ) {
    return this.adminService.blockUser(admin.id, userId, dto);
  }

  @Get('campaigns/pending')
  @ApiOperation({
    summary: 'List pending campaigns',
    description: 'Admin-only. Returns a paginated list of campaigns awaiting review (status: pending_review), ordered oldest first. Includes advertiser relation.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)', example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20)', example: 20 })
  @ApiOkResponse({
    description: 'Paginated pending campaigns list',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { type: 'object', description: 'Campaign objects with advertiser relation' } },
            total: { type: 'integer', example: 10 },
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  listPendingCampaigns(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.listPendingCampaigns({ page, limit });
  }

  @Patch('campaigns/:id/review')
  @ApiOperation({
    summary: 'Approve or reject a campaign',
    description:
      'Admin-only. Approves (sets status to active) or rejects (refunds budget to advertiser wallet) a pending campaign. ' +
      'Can only review campaigns with pending_review status.',
  })
  @ApiParam({ name: 'id', description: 'Campaign UUID', format: 'uuid' })
  @ApiOkResponse({
    description: 'Campaign reviewed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            campaignId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['active', 'rejected'], example: 'active' },
          },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Campaign not found' })
  @ApiConflictResponse({ description: 'Campaign already reviewed' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  reviewCampaign(
    @CurrentUser() admin: User,
    @Param('id') campaignId: string,
    @Body() dto: ReviewCampaignDto,
  ) {
    return this.adminService.reviewCampaign(admin.id, campaignId, dto);
  }

  @Get('withdrawals')
  @ApiOperation({
    summary: 'List withdrawals',
    description: 'Admin-only. Returns a paginated list of withdrawals with user and bank account relations. Can filter by status.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)', example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20)', example: 20 })
  @ApiQuery({ name: 'status', required: false, enum: ['processing', 'completed', 'failed'], description: 'Filter by withdrawal status' })
  @ApiOkResponse({
    description: 'Paginated withdrawals list',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  userId: { type: 'string', format: 'uuid' },
                  bankAccountId: { type: 'string', format: 'uuid' },
                  amount: { type: 'integer', description: 'Amount in kobo' },
                  status: { type: 'string', enum: ['processing', 'completed', 'failed'] },
                  paystackTransferCode: { type: 'string', nullable: true },
                  failureReason: { type: 'string', nullable: true },
                  createdAt: { type: 'string', format: 'date-time' },
                  user: { type: 'object', description: 'User relation' },
                  bankAccount: { type: 'object', description: 'BankAccount relation' },
                },
              },
            },
            total: { type: 'integer', example: 100 },
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  listWithdrawals(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: WithdrawalStatus,
  ) {
    return this.adminService.listWithdrawals({ page, limit, status });
  }

  @Get('analytics')
  @ApiOperation({
    summary: 'Get admin analytics',
    description: 'Admin-only. Returns platform-wide analytics: total users, campaigns, active campaigns, completed visits, total deposited, total withdrawn.',
  })
  @ApiOkResponse({
    description: 'Admin analytics data',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            totalUsers: { type: 'integer', example: 10000 },
            totalCampaigns: { type: 'integer', example: 500 },
            activeCampaigns: { type: 'integer', example: 150 },
            completedVisits: { type: 'integer', example: 500000 },
            totalDeposited: { type: 'integer', description: 'Sum of all wallet balances in kobo', example: 100000000000 },
            totalWithdrawn: { type: 'integer', description: 'Sum of all withdrawals in kobo', example: 50000000000 },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  getAnalytics() {
    return this.adminService.getAnalytics();
  }
}
