import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Campaign } from './entities/campaign.entity';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';
import { Wallet } from '../wallet/entities/wallet.entity';
import { Transaction } from '../wallet/entities/transaction.entity';
import {
  TransactionType,
  TransactionStatus,
  CampaignStatus,
  PricingTier,
} from '../../common/enums';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectRepository(Campaign) private campaignRepo: Repository<Campaign>,
    private dataSource: DataSource,
  ) {}

  static getPayPerVisit(pricingTier: PricingTier): number {
    const pricing: Record<PricingTier, number> = {
      [PricingTier.ECONOMY]: 5000,
      [PricingTier.STANDARD]: 10000,
      [PricingTier.PREMIUM]: 20000,
    };
    return pricing[pricingTier];
  }

  async createCampaign(userId: string, dto: CreateCampaignDto) {
    const payPerVisit = CampaignsService.getPayPerVisit(dto.pricingTier);

    if (dto.budget < dto.totalVisits * payPerVisit) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BUDGET',
        message: 'Budget must be at least totalVisits * payPerVisit.',
      });
    }

    return await this.dataSource.transaction(async (manager) => {
      // Debit wallet atomically
      const debitResult = await manager
        .getRepository(Wallet)
        .createQueryBuilder()
        .update()
        .set({ balance: () => 'balance - :budget' })
        .setParameter('budget', dto.budget)
        .where('userId = :userId AND balance >= :budget', {
          userId,
          budget: dto.budget,
        })
        .execute();

      if (debitResult.affected === 0) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient wallet balance for campaign budget.',
        });
      }

      // Create escrow transaction
      const wallet = await manager
        .getRepository(Wallet)
        .findOneBy({ userId });

      await manager.getRepository(Transaction).save({
        userId,
        walletId: wallet!.id,
        type: TransactionType.CAMPAIGN_ESCROW,
        amount: dto.budget,
        status: TransactionStatus.SUCCESSFUL,
        description: `Campaign budget escrow: ${dto.name}`,
      });

      // Create campaign
      const campaign = manager.getRepository(Campaign).create({
        advertiserId: userId,
        ...dto,
        payPerVisit,
        budget: dto.budget,
        status: CampaignStatus.PENDING_REVIEW,
      });

      return await manager.getRepository(Campaign).save(campaign);
    });
  }

  async findActiveById(campaignId: string) {
    return this.campaignRepo.findOne({
      where: { id: campaignId, status: CampaignStatus.ACTIVE },
    });
  }

  async listCampaigns(query: ListCampaignsDto) {
    const { campaignType, page = 1, limit = 20 } = query;

    const qb = this.campaignRepo
      .createQueryBuilder('campaign')
      .where('campaign.status = :status', { status: CampaignStatus.ACTIVE });

    if (campaignType) {
      qb.andWhere('campaign.campaignType = :campaignType', { campaignType });
    }

    qb.orderBy('campaign.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async listMyCampaigns(userId: string, query: ListCampaignsDto) {
    const { campaignType, page = 1, limit = 20 } = query;

    const qb = this.campaignRepo
      .createQueryBuilder('campaign')
      .where('campaign.advertiserId = :userId', { userId });

    if (campaignType) {
      qb.andWhere('campaign.campaignType = :campaignType', { campaignType });
    }

    qb.orderBy('campaign.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }
}
