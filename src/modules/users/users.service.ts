import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { VisitStatus } from '../../common/enums';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.usersRepo.findOneBy({ id });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.usersRepo.findOneBy({ googleId });
  }

  async findByReferralCode(referralCode: string): Promise<User | null> {
    return this.usersRepo.findOneBy({ referralCode });
  }

  async create(data: Partial<User>): Promise<User> {
    return this.usersRepo.save(data);
  }

  async update(userId: string, data: Partial<User>): Promise<User> {
    await this.usersRepo.update(userId, data);
    return this.findById(userId);
  }

  async getDashboardStats(userId: string) {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: ['wallet'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const visitStats = await this.usersRepo.manager
      .createQueryBuilder()
      .select('COUNT(v.id)', 'totalVisitsCompleted')
      .addSelect('COALESCE(SUM(v.earned), 0)', 'totalEarned')
      .from('visits', 'v')
      .where('v.userId = :userId', { userId })
      .andWhere('v.status = :status', { status: VisitStatus.COMPLETED })
      .getRawOne();

    const referralCount = await this.usersRepo.count({
      where: { referredById: userId },
    });

    return {
      user,
      walletBalance: user.wallet?.balance ?? 0,
      totalVisitsCompleted: Number(visitStats?.totalVisitsCompleted ?? 0),
      totalEarned: Number(visitStats?.totalEarned ?? 0),
      referralCount,
    };
  }
}
