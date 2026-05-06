import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { VisitStatus } from '../../../common/enums';
import { bigintTransformer } from '../../../common/transformers/bigint.transformer';
import { User } from '../../users/entities/user.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';

@Entity('visits')
@Index(['userId', 'campaignId'])
export class Visit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  campaignId: string;

  @Column({ type: 'timestamp' })
  serverStartTime: Date;

  @Column({ type: 'timestamp', nullable: true })
  serverEndTime: Date;

  @Column({ nullable: true })
  clientDuration: number;

  @Column('bigint', { nullable: true, transformer: bigintTransformer })
  earned: number;

  @Column({
    type: 'enum',
    enum: VisitStatus,
    default: VisitStatus.IN_PROGRESS,
  })
  status: VisitStatus;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, (u) => u.visits)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Campaign, (c) => c.visits)
  @JoinColumn({ name: 'campaignId' })
  campaign: Campaign;
}
