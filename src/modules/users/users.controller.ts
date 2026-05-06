import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Returns the full profile of the authenticated user.',
  })
  @ApiOkResponse({
    description: 'User profile retrieved',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', example: 'user@gmail.com' },
            fullName: { type: 'string', example: 'Chidera Okoro' },
            avatarUrl: { type: 'string', nullable: true, example: 'https://lh3.googleusercontent.com/...' },
            phone: { type: 'string', nullable: true, example: '08012345678' },
            referralCode: { type: 'string', example: 'CHID1234' },
            isDeposited: { type: 'boolean', example: false },
            isBlocked: { type: 'boolean', example: false },
            role: { type: 'string', enum: ['user', 'admin'], example: 'user' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async getMe(@CurrentUser() user: User) {
    return this.usersService.findById(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update current user profile',
    description: 'Update profile fields (fullName, phone) for the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Profile updated successfully. Returns the updated user object.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async updateMe(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.update(user.id, dto);
  }

  @Get('me/dashboard')
  @ApiOperation({
    summary: 'Get dashboard statistics',
    description: 'Returns aggregated stats for the authenticated user: wallet balance, total visits completed, total earned, and referral count.',
  })
  @ApiOkResponse({
    description: 'Dashboard stats retrieved',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            user: { type: 'object', description: 'Full user object with wallet relation' },
            walletBalance: { type: 'integer', description: 'Current wallet balance in kobo', example: 5000000 },
            totalVisitsCompleted: { type: 'integer', example: 42 },
            totalEarned: { type: 'integer', description: 'Total earnings in kobo', example: 420000 },
            referralCount: { type: 'integer', example: 3 },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async getDashboard(@CurrentUser() user: User) {
    return this.usersService.getDashboardStats(user.id);
  }
}
