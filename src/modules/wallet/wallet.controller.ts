import {
  Body,
  Controller,
  Delete,
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
import { WalletService } from './wallet.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { InitializeDepositDto } from './dto/initialize-deposit.dto';
import { VerifyDepositDto } from './dto/verify-deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { AddBankAccountDto } from './dto/add-bank-account.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';

@ApiTags('Wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  @ApiOperation({
    summary: 'Get wallet balance',
    description: 'Returns the current wallet balance in kobo for the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Wallet balance retrieved',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            balance: { type: 'integer', description: 'Balance in kobo', example: 5000000 },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  getBalance(@CurrentUser() user: User) {
    return this.walletService.getBalance(user.id);
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'List wallet transactions',
    description:
      'Returns a paginated list of wallet transactions. ' +
      'Can be filtered by transaction type (deposit, withdrawal, earning, referral_bonus, campaign_escrow).',
  })
  @ApiOkResponse({
    description: 'Paginated transactions list',
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
                  type: { type: 'string', enum: ['deposit', 'withdrawal', 'earning', 'referral_bonus', 'campaign_escrow'] },
                  amount: { type: 'integer', description: 'Amount in kobo', example: 10000 },
                  description: { type: 'string', example: 'Earned from campaign visit: My Blog' },
                  status: { type: 'string', enum: ['pending', 'successful', 'failed'] },
                  paystackReference: { type: 'string', nullable: true },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
            meta: {
              type: 'object',
              properties: {
                total: { type: 'integer', example: 50 },
                page: { type: 'integer', example: 1 },
                limit: { type: 'integer', example: 20 },
                totalPages: { type: 'integer', example: 3 },
              },
            },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  getTransactions(
    @CurrentUser() user: User,
    @Query() query: ListTransactionsDto,
  ) {
    return this.walletService.getTransactions(user.id, query);
  }

  @Post('deposit/initialize')
  @ApiOperation({
    summary: 'Initialize a deposit',
    description:
      'Creates a pending deposit transaction and returns a Paystack authorization URL. ' +
      'Minimum deposit is 1,500,000 kobo (15,000 NGN). ' +
      'Redirect the user to the authorization URL to complete payment.',
  })
  @ApiCreatedResponse({
    description: 'Deposit initialized — redirect user to authorizationUrl',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            authorizationUrl: { type: 'string', example: 'https://checkout.paystack.com/abc123' },
            reference: { type: 'string', example: 'TXN_abc123def456ghi789jk' },
            transactionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid amount or payment method' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  initializeDeposit(
    @CurrentUser() user: User,
    @Body() dto: InitializeDepositDto,
  ) {
    return this.walletService.initializeDeposit(user.id, dto);
  }

  @Post('deposit/verify')
  @ApiOperation({
    summary: 'Verify a deposit',
    description:
      'Verifies a deposit transaction via Paystack and credits the wallet if successful. ' +
      'Idempotent — verifying an already-successful transaction returns the existing data. ' +
      'First successful deposit marks the user as deposited (enables DepositGuard).',
  })
  @ApiOkResponse({
    description: 'Deposit verified and wallet credited',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Deposit successful' },
            transaction: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                type: { type: 'string', example: 'deposit' },
                amount: { type: 'integer' },
                status: { type: 'string', example: 'successful' },
                paystackReference: { type: 'string' },
              },
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Payment verification failed' })
  @ApiNotFoundResponse({ description: 'Transaction not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  verifyDeposit(@CurrentUser() user: User, @Body() dto: VerifyDepositDto) {
    return this.walletService.verifyDeposit(user.id, dto.transactionRef);
  }

  @Get('bank-accounts')
  @ApiOperation({
    summary: 'List bank accounts',
    description: 'Returns all saved bank accounts for the authenticated user, ordered by newest first.',
  })
  @ApiOkResponse({
    description: 'List of bank accounts',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              bankCode: { type: 'string', example: '058' },
              bankName: { type: 'string', example: '058' },
              accountNumber: { type: 'string', example: '0123456789' },
              accountName: { type: 'string', example: 'CHIDERA OKORO' },
              isDefault: { type: 'boolean', example: false },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  getBankAccounts(@CurrentUser() user: User) {
    return this.walletService.getBankAccounts(user.id);
  }

  @Post('bank-accounts')
  @ApiOperation({
    summary: 'Add a bank account',
    description:
      'Adds a new bank account. The account is verified via Paystack\'s resolve account API. ' +
      'Account name is resolved from Paystack, not the user input.',
  })
  @ApiCreatedResponse({
    description: 'Bank account added and verified',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            bankCode: { type: 'string', example: '058' },
            accountNumber: { type: 'string', example: '0123456789' },
            accountName: { type: 'string', example: 'CHIDERA OKORO' },
            isDefault: { type: 'boolean', example: false },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid bank code or account number' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  addBankAccount(@CurrentUser() user: User, @Body() dto: AddBankAccountDto) {
    return this.walletService.addBankAccount(user.id, dto);
  }

  @Delete('bank-accounts/:id')
  @ApiOperation({
    summary: 'Remove a bank account',
    description: 'Deletes a saved bank account. Only the owning user can remove it.',
  })
  @ApiParam({ name: 'id', description: 'Bank account UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Bank account removed' })
  @ApiNotFoundResponse({ description: 'Bank account not found or not owned by user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  removeBankAccount(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.walletService.removeBankAccount(user.id, id);
  }

  @Post('withdraw')
  @ApiOperation({
    summary: 'Request a withdrawal',
    description:
      'Debits the wallet and queues a Paystack transfer to the specified bank account. ' +
      'Minimum withdrawal is 500,000 kobo (5,000 NGN). ' +
      'Withdrawals over 10,000,000 kobo (100,000 NGN) require admin review and skip auto-transfer.',
  })
  @ApiCreatedResponse({
    description: 'Withdrawal request submitted and queued for processing',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Withdrawal request submitted' },
            withdrawal: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                userId: { type: 'string', format: 'uuid' },
                bankAccountId: { type: 'string', format: 'uuid' },
                amount: { type: 'integer', description: 'Amount in kobo', example: 500000 },
                status: { type: 'string', example: 'processing' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Insufficient balance or invalid amount' })
  @ApiNotFoundResponse({ description: 'Bank account not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  withdraw(@CurrentUser() user: User, @Body() dto: WithdrawDto) {
    return this.walletService.requestWithdrawal(user.id, dto);
  }
}
