import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiParam,
} from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresDeposit } from '../../common/decorators/requires-deposit.decorator';

@ApiTags('Campaigns')
@ApiBearerAuth()
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @ApiOperation({
    summary: 'List active campaigns',
    description:
      'Returns a paginated list of active campaigns. ' +
      'Can be filtered by campaign type (blog/youtube).',
  })
  @ApiOkResponse({
    description: 'Paginated list of active campaigns',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  name: { type: 'string', example: 'My Blog Campaign' },
                  url: { type: 'string', example: 'https://myblog.com/post' },
                  description: { type: 'string' },
                  campaignType: { type: 'string', enum: ['blog', 'youtube'] },
                  pricingTier: { type: 'string', enum: ['economy', 'standard', 'premium'] },
                  payPerVisit: { type: 'integer', description: 'Pay per visit in kobo', example: 10000 },
                  minDuration: { type: 'integer', description: 'Minimum duration in seconds', example: 60 },
                  totalVisits: { type: 'integer', example: 100 },
                  completedVisits: { type: 'integer', example: 42 },
                  budget: { type: 'integer', description: 'Total budget in kobo' },
                  status: { type: 'string', example: 'active' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
            total: { type: 'integer', example: 50 },
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  listCampaigns(@Query() query: ListCampaignsDto) {
    return this.campaignsService.listCampaigns(query);
  }

  @Get('mine')
  @ApiOperation({
    summary: 'List my campaigns',
    description:
      'Returns a paginated list of campaigns created by the authenticated user (all statuses). ' +
      'Can be filtered by campaign type.',
  })
  @ApiOkResponse({ description: 'Paginated list of own campaigns (same shape as GET /campaigns)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  listMyCampaigns(
    @CurrentUser('id') userId: string,
    @Query() query: ListCampaignsDto,
  ) {
    return this.campaignsService.listMyCampaigns(userId, query);
  }

  @Post()
  @RequiresDeposit()
  @ApiOperation({
    summary: 'Create a campaign',
    description:
      'Creates a new campaign and escrows the budget from the advertiser\'s wallet atomically. ' +
      'Requires the user to have made at least one deposit (DepositGuard). ' +
      'Budget must be >= totalVisits * payPerVisit. Campaign starts in pending_review status.',
  })
  @ApiCreatedResponse({
    description: 'Campaign created and budget escrowed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            advertiserId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            url: { type: 'string' },
            campaignType: { type: 'string', enum: ['blog', 'youtube'] },
            pricingTier: { type: 'string', enum: ['economy', 'standard', 'premium'] },
            payPerVisit: { type: 'integer', example: 10000 },
            minDuration: { type: 'integer', example: 60 },
            totalVisits: { type: 'integer', example: 100 },
            completedVisits: { type: 'integer', example: 0 },
            budget: { type: 'integer', example: 1500000 },
            spent: { type: 'integer', example: 0 },
            status: { type: 'string', example: 'pending_review' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Insufficient budget or insufficient wallet balance' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  createCampaign(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.campaignsService.createCampaign(userId, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get campaign by ID',
    description: 'Returns a single active campaign by its UUID.',
  })
  @ApiParam({ name: 'id', description: 'Campaign UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Campaign found and returned' })
  @ApiNotFoundResponse({ description: 'Campaign not found or not active' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaignsService.findActiveById(id);
  }
}
