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
  ApiForbiddenResponse,
  ApiConflictResponse,
  ApiGoneResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { VisitsService } from './visits.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresDeposit } from '../../common/decorators/requires-deposit.decorator';
import { User } from '../users/entities/user.entity';
import { StartVisitDto } from './dto/start-visit.dto';
import { CompleteVisitDto } from './dto/complete-visit.dto';

@ApiTags('Visits')
@ApiBearerAuth()
@Controller('visits')
export class VisitsController {
  constructor(private readonly visitsService: VisitsService) {}

  @Post('start')
  @RequiresDeposit()
  @ApiOperation({
    summary: 'Start a campaign visit',
    description:
      'Starts a new visit to a campaign. Requires a prior deposit (DepositGuard). ' +
      'Only one in-progress visit per user is allowed. Stale visits (>10min) are auto-abandoned. ' +
      'Self-visits and duplicate completed visits to the same campaign are blocked.',
  })
  @ApiCreatedResponse({
    description: 'Visit started successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            visitId: { type: 'string', format: 'uuid' },
            campaignId: { type: 'string', format: 'uuid' },
            minDuration: { type: 'integer', description: 'Minimum visit duration in seconds', example: 60 },
            serverStartTime: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Campaign not found' })
  @ApiForbiddenResponse({ description: 'Cannot visit your own campaign' })
  @ApiConflictResponse({ description: 'Already have an active visit, or already completed this campaign' })
  @ApiGoneResponse({ description: 'Campaign is no longer active or has no available slots' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  startVisit(@CurrentUser() user: User, @Body() dto: StartVisitDto) {
    return this.visitsService.startVisit(user.id, dto);
  }

  @Post(':id/complete')
  @ApiOperation({
    summary: 'Complete a visit',
    description:
      'Marks a visit as completed and credits the user\'s wallet. ' +
      'Server-side timing is authoritative — the minimum duration must have elapsed since serverStartTime. ' +
      'Uses pessimistic locking to prevent double-credit. Idempotent — completing an already-completed visit returns the existing data. ' +
      'Triggers an async referral milestone check via BullMQ.',
  })
  @ApiParam({ name: 'id', description: 'Visit UUID', format: 'uuid' })
  @ApiOkResponse({
    description: 'Visit completed and earnings credited',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            visitId: { type: 'string', format: 'uuid' },
            earned: { type: 'integer', description: 'Amount earned in kobo', example: 10000 },
            serverEndTime: { type: 'string', format: 'date-time' },
            clientDuration: { type: 'integer', example: 65 },
            balance: { type: 'integer', description: 'Updated wallet balance in kobo', example: 5010000 },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Minimum visit duration not met (server time)' })
  @ApiNotFoundResponse({ description: 'Visit not found' })
  @ApiForbiddenResponse({ description: 'You do not own this visit' })
  @ApiGoneResponse({ description: 'Campaign slots exhausted' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  completeVisit(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteVisitDto,
  ) {
    return this.visitsService.completeVisit(user.id, id, dto.clientDuration);
  }

  @Get('history')
  @ApiOperation({
    summary: 'Get visit history',
    description: 'Returns a paginated list of the authenticated user\'s visits with campaign details.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)', example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20)', example: 20 })
  @ApiOkResponse({
    description: 'Paginated visit history',
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
                  campaignId: { type: 'string', format: 'uuid' },
                  serverStartTime: { type: 'string', format: 'date-time' },
                  serverEndTime: { type: 'string', format: 'date-time', nullable: true },
                  clientDuration: { type: 'integer', nullable: true },
                  earned: { type: 'integer', nullable: true, description: 'In kobo' },
                  status: { type: 'string', enum: ['in_progress', 'completed', 'abandoned'] },
                  createdAt: { type: 'string', format: 'date-time' },
                  campaign: { type: 'object', description: 'Related campaign object' },
                },
              },
            },
            meta: {
              type: 'object',
              properties: {
                total: { type: 'integer', example: 100 },
                page: { type: 'integer', example: 1 },
                limit: { type: 'integer', example: 20 },
                totalPages: { type: 'integer', example: 5 },
              },
            },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  getHistory(
    @CurrentUser() user: User,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.visitsService.getHistory(
      user.id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }
}
