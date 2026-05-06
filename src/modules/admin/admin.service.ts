import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { Withdrawal } from '../wallet/entities/withdrawal.entity';
import { Wallet } from '../wallet/entities/wallet.entity';
import { Transaction } from '../wallet/entities/transaction.entity';
import { Visit } from '../visits/entities/visit.entity';
import { AuthService } from '../auth/auth.service';
import {
  CampaignStatus,
  TransactionStatus,
  TransactionType,
  VisitStatus,
  WithdrawalStatus,
} from '../../common/enums';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Campaign) private campaignRepo: Repository<Campaign>,
    @InjectRepository(Withdrawal) private withdrawalRepo: Repository<Withdrawal>,
    @InjectRepository(Wallet) private walletRepo: Repository<Wallet>,
    @InjectRepository(Transaction) private transactionRepo: Repository<Transaction>,
    @InjectRepository(Visit) private visitRepo: Repository<Visit>,
    @Inject(forwardRef(() => AuthService)) private authService: AuthService,
    private dataSource: DataSource,
  ) {}

  async blockUser(
    adminId: string,
    userId: string,
    dto: { isBlocked: boolean; reason?: string },
  ) {
    await this.userRepo.update(userId, {
      isBlocked: dto.isBlocked,
      blockedReason: dto.isBlocked ? (dto.reason ?? undefined) : undefined,
      blockedAt: dto.isBlocked ? new Date() : undefined,
    });

    if (dto.isBlocked) {
      await this.authService.revokeAllUserSessions(userId);
    }

    this.logger.log({
      event: 'admin_block_user',
      adminId,
      targetUserId: userId,
      isBlocked: dto.isBlocked,
      reason: dto.reason,
    });

    return { userId, isBlocked: dto.isBlocked, reason: dto.reason };
  }

  async reviewCampaign(
    adminId: string,
    campaignId: string,
    dto: { action: 'approve' | 'reject'; reason?: string },
  ) {
    const campaign = await this.campaignRepo.findOneBy({ id: campaignId });
    if (!campaign) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (campaign.status !== CampaignStatus.PENDING_REVIEW) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Campaign already reviewed.',
      });
    }

    const newStatus =
      dto.action === 'approve'
        ? CampaignStatus.ACTIVE
        : CampaignStatus.REJECTED;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Campaign).update(campaignId, {
        status: newStatus,
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: dto.action === 'reject' ? (dto.reason ?? undefined) : undefined,
      });

      if (dto.action === 'reject') {
        await manager
          .getRepository(Wallet)
          .createQueryBuilder()
          .update()
          .set({ balance: () => 'balance + :budget' })
          .setParameter('budget', campaign.budget)
          .where('userId = :userId', { userId: campaign.advertiserId })
          .execute();

        const wallet = await manager
          .getRepository(Wallet)
          .findOneBy({ userId: campaign.advertiserId });

        await manager.getRepository(Transaction).save({
          userId: campaign.advertiserId,
          walletId: wallet!.id,
          type: TransactionType.CAMPAIGN_ESCROW,
          amount: campaign.budget,
          status: TransactionStatus.SUCCESSFUL,
          description: `Campaign budget refund (rejected): ${campaign.name}`,
        });
      }
    });

    this.logger.log({
      event: 'admin_review_campaign',
      adminId,
      campaignId,
      action: dto.action,
    });

    return { campaignId, status: newStatus };
  }

  async listUsers(query: { page?: number; limit?: number; search?: string }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.userRepo.createQueryBuilder('u');

    if (query.search) {
      qb.where('u.email ILIKE :search OR u.fullName ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    qb.orderBy('u.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  async listPendingCampaigns(query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await this.campaignRepo.findAndCount({
      where: { status: CampaignStatus.PENDING_REVIEW },
      relations: ['advertiser'],
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  async listWithdrawals(query: {
    page?: number;
    limit?: number;
    status?: WithdrawalStatus;
  }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: any = {};
    if (query.status) where.status = query.status;

    const [items, total] = await this.withdrawalRepo.findAndCount({
      where,
      relations: ['user', 'bankAccount'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  async getAnalytics() {
    const [
      totalUsers,
      totalCampaigns,
      activeCampaigns,
      completedVisits,
      totalDeposited,
      totalWithdrawn,
    ] = await Promise.all([
      this.userRepo.count(),
      this.campaignRepo.count(),
      this.campaignRepo.count({ where: { status: CampaignStatus.ACTIVE } }),
      this.visitRepo.count({ where: { status: VisitStatus.COMPLETED } }),
      this.walletRepo
        .createQueryBuilder('w')
        .select('COALESCE(SUM(w.balance), 0)', 'total')
        .getRawOne()
        .then((r) => Number(r.total)),
      this.walletRepo
        .createQueryBuilder('w')
        .select('COALESCE(SUM(w.totalWithdrawn), 0)', 'total')
        .getRawOne()
        .then((r) => Number(r.total)),
    ]);

    return {
      totalUsers,
      totalCampaigns,
      activeCampaigns,
      completedVisits,
      totalDeposited,
      totalWithdrawn,
    };
  }
}
