import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { DataSource, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { nanoid } from 'nanoid';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';
import { BankAccount } from './entities/bank-account.entity';
import { Withdrawal } from './entities/withdrawal.entity';
import {
  TransactionType,
  TransactionStatus,
  WithdrawalStatus,
} from '../../common/enums';
import { UsersService } from '../users/users.service';
import { PaystackService } from '../shared/paystack/paystack.service';
import { InitializeDepositDto } from './dto/initialize-deposit.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { AddBankAccountDto } from './dto/add-bank-account.dto';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(Wallet) private walletRepo: Repository<Wallet>,
    @InjectRepository(Transaction)
    private transactionRepo: Repository<Transaction>,
    @InjectRepository(BankAccount)
    private bankAccountRepo: Repository<BankAccount>,
    @InjectRepository(Withdrawal)
    private withdrawalRepo: Repository<Withdrawal>,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    private paystackService: PaystackService,
    private config: ConfigService,
    private dataSource: DataSource,
    @InjectQueue('withdrawal-processing') private withdrawalQueue: Queue,
    @InjectQueue('referral-milestones') private referralMilestoneQueue: Queue,
  ) {}

  // ── Create wallet ──────────────────────────────────────────────────

  async createWallet(userId: string): Promise<Wallet> {
    const existing = await this.walletRepo.findOneBy({ userId });
    if (existing) {
      return existing;
    }
    const wallet = this.walletRepo.create({ userId, balance: 0 });
    return this.walletRepo.save(wallet);
  }

  // ── Get wallet ─────────────────────────────────────────────────────

  async getWallet(userId: string): Promise<Wallet> {
    const wallet = await this.walletRepo.findOneBy({ userId });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

  // ── Get balance ────────────────────────────────────────────────────

  async getBalance(userId: string): Promise<{ balance: number }> {
    const wallet = await this.getWallet(userId);
    return { balance: wallet.balance };
  }

  // ── Credit referral bonus ──────────────────────────────────────────

  async creditReferralBonus(
    userId: string,
    amountKobo: number,
    description: string,
  ): Promise<Transaction> {
    const wallet = await this.getWallet(userId);

    return this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(Wallet)
        .set({
          balance: () => '"balance" + :amount',
          totalEarned: () => '"totalEarned" + :amount',
        })
        .where('id = :walletId', { walletId: wallet.id })
        .setParameter('amount', amountKobo)
        .execute();

      if (!result.affected) {
        throw new ConflictException('Failed to credit wallet');
      }

      const txn = manager.create(Transaction, {
        userId,
        walletId: wallet.id,
        type: TransactionType.REFERRAL_BONUS,
        amount: amountKobo,
        description,
        status: TransactionStatus.SUCCESSFUL,
      });

      return manager.save(txn);
    });
  }

  // ── Get transactions (paginated) ──────────────────────────────────

  async getTransactions(userId: string, query: ListTransactionsDto) {
    const wallet = await this.getWallet(userId);
    const { type, page = 1, limit = 20 } = query;

    const qb = this.transactionRepo
      .createQueryBuilder('txn')
      .where('txn.walletId = :walletId', { walletId: wallet.id });

    if (type) {
      qb.andWhere('txn.type = :type', { type });
    }

    qb.orderBy('txn.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── Initialize deposit ─────────────────────────────────────────────

  async initializeDeposit(userId: string, dto: InitializeDepositDto) {
    const wallet = await this.getWallet(userId);
    const user = await this.usersService.findById(userId);

    const reference = `TXN_${nanoid(20)}`;

    const paystackRes = await this.paystackService.initializeTransaction({
      email: user.email,
      amount: dto.amount,
      reference,
      callback_url: this.config.get<string>('paystackCallbackUrl'),
      metadata: {
        userId,
        walletId: wallet.id,
        paymentMethod: dto.paymentMethod,
      },
    });

    const txn = this.transactionRepo.create({
      userId,
      walletId: wallet.id,
      type: TransactionType.DEPOSIT,
      amount: dto.amount,
      description: 'Wallet deposit',
      status: TransactionStatus.PENDING,
      paystackReference: paystackRes.reference,
      metadata: { paymentMethod: dto.paymentMethod },
    });
    await this.transactionRepo.save(txn);

    return {
      authorizationUrl: paystackRes.authorization_url,
      reference: paystackRes.reference,
      transactionId: txn.id,
    };
  }

  // ── Verify deposit ─────────────────────────────────────────────────

  async verifyDeposit(userId: string, transactionRef: string) {
    const txn = await this.transactionRepo.findOneBy({
      paystackReference: transactionRef,
      userId,
    });

    if (!txn) {
      throw new NotFoundException('Transaction not found');
    }

    if (txn.status === TransactionStatus.SUCCESSFUL) {
      return { message: 'Transaction already verified', transaction: txn };
    }

    const verification =
      await this.paystackService.verifyTransaction(transactionRef);

    if (verification.status === 'success') {
      await this.creditWalletFromDeposit(userId, txn.id, verification.amount);

      const updatedTxn = await this.transactionRepo.findOneBy({ id: txn.id });
      return { message: 'Deposit successful', transaction: updatedTxn };
    }

    await this.transactionRepo.update(txn.id, {
      status: TransactionStatus.FAILED,
    });
    throw new BadRequestException('Payment verification failed');
  }

  // ── Credit wallet from deposit (atomic) ────────────────────────────

  async creditWalletFromDeposit(
    userId: string,
    txnId: string,
    amount: number,
  ): Promise<void> {
    const wallet = await this.getWallet(userId);

    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(Wallet)
        .set({
          balance: () => '"balance" + :amount',
          totalEarned: () => '"totalEarned" + :amount',
        })
        .where('id = :walletId', { walletId: wallet.id })
        .setParameter('amount', amount)
        .execute();

      if (!result.affected) {
        throw new ConflictException('Failed to credit wallet');
      }

      await manager.update(Transaction, txnId, {
        status: TransactionStatus.SUCCESSFUL,
      });

      // Mark user as deposited on first deposit
      await manager
        .createQueryBuilder()
        .update('users')
        .set({ isDeposited: true })
        .where('id = :userId AND "isDeposited" = false', { userId })
        .execute();
    });

    // Queue referral milestone check after the transaction commits
    await this.referralMilestoneQueue.add('check-milestone-1', { userId });
  }

  // ── Handle Paystack webhook ────────────────────────────────────────

  async handlePaystackWebhook(event: string, data: any): Promise<void> {
    switch (event) {
      case 'charge.success': {
        const reference = data.reference;
        const txn = await this.transactionRepo.findOneBy({
          paystackReference: reference,
        });
        if (!txn || txn.status === TransactionStatus.SUCCESSFUL) return;

        await this.creditWalletFromDeposit(txn.userId, txn.id, data.amount);
        this.logger.log({
          event: 'webhook_charge_success',
          reference,
        });
        break;
      }

      case 'transfer.success': {
        const transferCode = data.transfer_code;
        const withdrawal = await this.withdrawalRepo.findOneBy({
          paystackTransferCode: transferCode,
        });
        if (!withdrawal) return;

        await this.withdrawalRepo.update(withdrawal.id, {
          status: WithdrawalStatus.COMPLETED,
          processedAt: new Date(),
        });

        if (withdrawal.transactionId) {
          await this.transactionRepo.update(withdrawal.transactionId, {
            status: TransactionStatus.SUCCESSFUL,
          });
        }

        this.logger.log({
          event: 'webhook_transfer_success',
          transferCode,
        });
        break;
      }

      case 'transfer.failed':
      case 'transfer.reversed': {
        const transferCode = data.transfer_code;
        const withdrawal = await this.withdrawalRepo.findOneBy({
          paystackTransferCode: transferCode,
        });
        if (!withdrawal) return;

        // Reverse the debit atomically
        const wallet = await this.getWallet(withdrawal.userId);
        await this.dataSource.transaction(async (manager) => {
          const result = await manager
            .createQueryBuilder()
            .update(Wallet)
            .set({
              balance: () => '"balance" + :amount',
              totalWithdrawn: () => '"totalWithdrawn" - :amount',
            })
            .where('id = :walletId', { walletId: wallet.id })
            .setParameter('amount', withdrawal.amount)
            .execute();

          if (!result.affected) {
            throw new ConflictException('Failed to reverse wallet debit');
          }

          await manager.update(Withdrawal, withdrawal.id, {
            status: WithdrawalStatus.FAILED,
            failureReason: data.reason ?? event,
            processedAt: new Date(),
          });

          if (withdrawal.transactionId) {
            await manager.update(Transaction, withdrawal.transactionId, {
              status: TransactionStatus.FAILED,
            });
          }
        });

        this.logger.log({
          event: `webhook_${event.replace('.', '_')}`,
          transferCode,
        });
        break;
      }

      default:
        this.logger.warn({ event: 'unhandled_webhook_event', type: event });
    }
  }

  // ── Request withdrawal ─────────────────────────────────────────────

  async requestWithdrawal(userId: string, dto: WithdrawDto) {
    const wallet = await this.getWallet(userId);

    if (wallet.balance < dto.amount) {
      throw new BadRequestException('Insufficient balance');
    }

    const bankAccount = await this.bankAccountRepo.findOneBy({
      id: dto.bankAccountId,
      userId,
    });
    if (!bankAccount) {
      throw new NotFoundException('Bank account not found');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const debitResult = await manager
        .createQueryBuilder()
        .update(Wallet)
        .set({
          balance: () => '"balance" - :amount',
          totalWithdrawn: () => '"totalWithdrawn" + :amount',
        })
        .where('id = :walletId AND "balance" >= :amount', {
          walletId: wallet.id,
        })
        .setParameter('amount', dto.amount)
        .execute();

      if (!debitResult.affected) {
        throw new BadRequestException('Insufficient balance');
      }

      const txn = manager.create(Transaction, {
        userId,
        walletId: wallet.id,
        type: TransactionType.WITHDRAWAL,
        amount: dto.amount,
        description: 'Wallet withdrawal',
        status: TransactionStatus.PENDING,
      });
      const savedTxn = await manager.save(txn);

      const withdrawal = manager.create(Withdrawal, {
        userId,
        bankAccountId: dto.bankAccountId,
        transactionId: savedTxn.id,
        amount: dto.amount,
        status: WithdrawalStatus.PROCESSING,
      });
      const savedWithdrawal = await manager.save(withdrawal);

      return { transaction: savedTxn, withdrawal: savedWithdrawal };
    });

    await this.withdrawalQueue.add('process-withdrawal', {
      withdrawalId: result.withdrawal.id,
    });

    return {
      message: 'Withdrawal request submitted',
      withdrawal: result.withdrawal,
    };
  }

  // ── Add bank account ───────────────────────────────────────────────

  async addBankAccount(
    userId: string,
    dto: AddBankAccountDto,
  ): Promise<BankAccount> {
    const resolved = await this.paystackService.resolveAccount(
      dto.accountNumber,
      dto.bankCode,
    );

    const bankAccount = this.bankAccountRepo.create({
      userId,
      bankCode: dto.bankCode,
      bankName: dto.bankCode,
      accountNumber: resolved.account_number,
      accountName: resolved.account_name,
    });

    return this.bankAccountRepo.save(bankAccount);
  }

  // ── Get bank accounts ──────────────────────────────────────────────

  async getBankAccounts(userId: string): Promise<BankAccount[]> {
    return this.bankAccountRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // ── Remove bank account ────────────────────────────────────────────

  async removeBankAccount(
    userId: string,
    bankAccountId: string,
  ): Promise<void> {
    const bankAccount = await this.bankAccountRepo.findOneBy({
      id: bankAccountId,
      userId,
    });

    if (!bankAccount) {
      throw new NotFoundException('Bank account not found');
    }

    await this.bankAccountRepo.remove(bankAccount);
  }
}
