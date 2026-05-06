import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Visit } from './entities/visit.entity';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { Wallet } from '../wallet/entities/wallet.entity';
import { Transaction } from '../wallet/entities/transaction.entity';
import {
  VisitStatus,
  CampaignStatus,
  TransactionType,
  TransactionStatus,
} from '../../common/enums';
import { CampaignsService } from '../campaigns/campaigns.service';
import { WalletService } from '../wallet/wallet.service';
import { StartVisitDto } from './dto/start-visit.dto';

@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(
    @InjectRepository(Visit) private visitRepo: Repository<Visit>,
    private campaignsService: CampaignsService,
    private walletService: WalletService,
    private dataSource: DataSource,
    @InjectQueue('referral-milestones')
    private referralMilestoneQueue: Queue,
  ) {}

  // ── Start Visit ────────────────────────────────────────────────────

  async startVisit(userId: string, dto: StartVisitDto) {
    // 1. Find active campaign
    const campaign = await this.campaignsService.findActiveById(dto.campaignId);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    // 2. Check campaign is active
    if (campaign.status !== CampaignStatus.ACTIVE) {
      throw new GoneException('Campaign is no longer active');
    }

    // 3. Check campaign has available slots
    if (campaign.completedVisits >= campaign.totalVisits) {
      throw new GoneException('Campaign has no available slots');
    }

    // 4. Block self-visits
    if (campaign.advertiserId === userId) {
      throw new ForbiddenException('You cannot visit your own campaign');
    }

    // 5. Auto-abandon stale in-progress visits older than 10 minutes
    const STALE_THRESHOLD_MS = 10 * 60 * 1000;
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);
    await this.visitRepo
      .createQueryBuilder()
      .update()
      .set({ status: VisitStatus.ABANDONED })
      .where(
        'userId = :userId AND status = :status AND "serverStartTime" < :threshold',
        {
          userId,
          status: VisitStatus.IN_PROGRESS,
          threshold: staleThreshold,
        },
      )
      .execute();

    // 6. Check for active in-progress visit
    const activeVisit = await this.visitRepo.findOneBy({
      userId,
      status: VisitStatus.IN_PROGRESS,
    });
    if (activeVisit) {
      throw new ConflictException('You already have an active visit');
    }

    // 7. Check if already completed this campaign
    const completedVisit = await this.visitRepo.findOneBy({
      userId,
      campaignId: dto.campaignId,
      status: VisitStatus.COMPLETED,
    });
    if (completedVisit) {
      throw new ConflictException('You have already completed this campaign');
    }

    // 8. Create visit
    const serverStartTime = new Date();
    const visit = this.visitRepo.create({
      userId,
      campaignId: dto.campaignId,
      serverStartTime,
      status: VisitStatus.IN_PROGRESS,
    });
    const saved = await this.visitRepo.save(visit);

    // 9. Return visit data
    return {
      visitId: saved.id,
      campaignId: saved.campaignId,
      minDuration: campaign.minDuration,
      serverStartTime: saved.serverStartTime,
    };
  }

  // ── Complete Visit ─────────────────────────────────────────────────

  async completeVisit(
    userId: string,
    visitId: string,
    clientDuration: number,
  ) {
    // 1. Find visit with campaign relation
    const visit = await this.visitRepo.findOne({
      where: { id: visitId },
      relations: ['campaign'],
    });
    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    // 2. Check ownership
    if (visit.userId !== userId) {
      throw new ForbiddenException('You do not own this visit');
    }

    // 3. Idempotent: if already completed, return existing data
    if (visit.status === VisitStatus.COMPLETED) {
      return {
        visitId: visit.id,
        earned: visit.earned,
        serverEndTime: visit.serverEndTime,
        clientDuration: visit.clientDuration,
      };
    }

    // 4. Server-side time check
    const serverElapsed =
      (Date.now() - visit.serverStartTime.getTime()) / 1000;
    if (serverElapsed < visit.campaign.minDuration) {
      throw new BadRequestException(
        'Minimum visit duration has not been met (server time)',
      );
    }

    const earned = visit.campaign.payPerVisit;

    // 5. Atomic transaction with pessimistic locking
    const result = await this.dataSource.transaction(async (manager) => {
      // a. Lock visit row
      const lockedVisit = await manager.findOne(Visit, {
        where: { id: visitId },
        lock: { mode: 'pessimistic_write' },
      });

      // b. Race check: if already completed, return existing
      if (!lockedVisit || lockedVisit.status === VisitStatus.COMPLETED) {
        return {
          alreadyCompleted: true,
          visitId: lockedVisit?.id ?? visitId,
          earned: lockedVisit?.earned ?? 0,
          serverEndTime: lockedVisit?.serverEndTime,
          clientDuration: lockedVisit?.clientDuration,
        };
      }

      // c. Claim campaign slot FIRST
      const claimResult = await manager
        .createQueryBuilder()
        .update(Campaign)
        .set({
          spent: () => '"spent" + :earned',
          completedVisits: () => '"completedVisits" + 1',
        })
        .where(
          'id = :id AND "completedVisits" < "totalVisits"',
          { id: visit.campaignId },
        )
        .setParameter('earned', earned)
        .execute();

      if (claimResult.affected === 0) {
        // Slots exhausted - abandon visit
        await manager.update(Visit, visitId, {
          status: VisitStatus.ABANDONED,
        });
        throw new GoneException('Campaign slots exhausted');
      }

      // d. Mark visit completed
      const serverEndTime = new Date();
      await manager.update(Visit, visitId, {
        status: VisitStatus.COMPLETED,
        serverEndTime,
        clientDuration,
        earned,
      });

      // e. Credit earner wallet atomically
      const wallet = await manager.findOneBy(Wallet, { userId });
      if (!wallet) throw new NotFoundException('Wallet not found');
      await manager
        .createQueryBuilder()
        .update(Wallet)
        .set({
          balance: () => '"balance" + :amount',
          totalEarned: () => '"totalEarned" + :amount',
        })
        .where('id = :walletId', { walletId: wallet.id })
        .setParameter('amount', earned)
        .execute();

      // f. Create earning transaction record
      await manager.save(Transaction, {
        userId,
        walletId: wallet.id,
        type: TransactionType.EARNING,
        amount: earned,
        description: `Earned from campaign visit: ${visit.campaign.name}`,
        status: TransactionStatus.SUCCESSFUL,
      });

      // g. Auto-complete campaign if completedVisits >= totalVisits
      const updatedCampaign = await manager.findOneBy(Campaign, {
        id: visit.campaignId,
      });
      if (updatedCampaign && updatedCampaign.completedVisits >= updatedCampaign.totalVisits) {
        await manager.update(Campaign, visit.campaignId, {
          status: CampaignStatus.COMPLETED,
        });
      }

      // h. Read final wallet balance
      const finalWallet = await manager.findOneBy(Wallet, {
        id: wallet.id,
      });

      return {
        alreadyCompleted: false,
        visitId,
        earned,
        serverEndTime,
        clientDuration,
        balance: finalWallet?.balance ?? 0,
      };
    });

    // 6. Queue referral milestone check if not already completed
    if (!result.alreadyCompleted) {
      await this.referralMilestoneQueue.add('check-milestone-2', { userId });
    }

    return result;
  }

  // ── Visit History ──────────────────────────────────────────────────

  async getHistory(userId: string, page = 1, limit = 20) {
    const [data, total] = await this.visitRepo.findAndCount({
      where: { userId },
      relations: ['campaign'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

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
}
