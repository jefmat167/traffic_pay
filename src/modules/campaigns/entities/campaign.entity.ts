import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  CampaignStatus,
  CampaignType,
  PricingTier,
} from '../../../common/enums';
import { bigintTransformer } from '../../../common/transformers/bigint.transformer';
import { User } from '../../users/entities/user.entity';
import { Visit } from '../../visits/entities/visit.entity';

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  advertiserId: string;

  @Column()
  name: string;

  @Column()
  url: string;

  @Column('text')
  description: string;

  @Column({ type: 'enum', enum: CampaignType })
  campaignType: CampaignType;

  @Column({ type: 'enum', enum: PricingTier })
  pricingTier: PricingTier;

  @Column('bigint', { transformer: bigintTransformer })
  payPerVisit: number;

  @Column()
  minDuration: number;

  @Column()
  totalVisits: number;

  @Column({ default: 0 })
  completedVisits: number;

  @Column('bigint', { transformer: bigintTransformer })
  budget: number;

  @Column('bigint', { default: 0, transformer: bigintTransformer })
  spent: number;

  @Column({ nullable: true })
  icon: string;

  @Column({ nullable: true })
  bgColor: string;

  @Column({ nullable: true })
  fgColor: string;

  @Column({ nullable: true })
  badge: string;

  @Column({ nullable: true })
  badgeLabel: string;

  @Column({
    type: 'enum',
    enum: CampaignStatus,
    default: CampaignStatus.PENDING_REVIEW,
  })
  status: CampaignStatus;

  @Column({ nullable: true })
  reviewedById: string;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date;

  @Column({ nullable: true })
  rejectionReason: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (u) => u.campaigns)
  @JoinColumn({ name: 'advertiserId' })
  advertiser: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reviewedById' })
  reviewedBy: User;

  @OneToMany(() => Visit, (v) => v.campaign)
  visits: Visit[];
}
