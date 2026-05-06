import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { bigintTransformer } from '../../../common/transformers/bigint.transformer';
import { User } from '../../users/entities/user.entity';

@Entity('referrals')
export class Referral {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  referrerId: string;

  @Column({ unique: true })
  refereeId: string;

  @Column({ default: false })
  milestone1Credited: boolean;

  @Column({ type: 'timestamp', nullable: true })
  milestone1CreditedAt: Date;

  @Column({ default: false })
  milestone2Credited: boolean;

  @Column({ type: 'timestamp', nullable: true })
  milestone2CreditedAt: Date;

  @Column('bigint', { default: 0, transformer: bigintTransformer })
  totalEarned: number;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'referrerId' })
  referrer: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'refereeId' })
  referee: User;
}
