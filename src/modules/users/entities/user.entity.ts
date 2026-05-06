import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../../common/enums';
import { Wallet } from '../../wallet/entities/wallet.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { Visit } from '../../visits/entities/visit.entity';
import { BankAccount } from '../../wallet/entities/bank-account.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  googleId: string;

  @Column({ unique: true })
  email: string;

  @Column()
  fullName: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ unique: true })
  referralCode: string;

  @Column({ nullable: true })
  referredById: string;

  @Column({ default: false })
  isDeposited: boolean;

  @Column({ default: false })
  isBlocked: boolean;

  @Column({ nullable: true })
  blockedReason: string;

  @Column({ type: 'timestamp', nullable: true })
  blockedAt: Date;

  @Column({ type: 'enum', enum: Role, default: Role.USER })
  role: Role;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations
  @OneToOne(() => Wallet, (w) => w.user)
  wallet: Wallet;

  @OneToMany(() => Campaign, (c) => c.advertiser)
  campaigns: Campaign[];

  @OneToMany(() => Visit, (v) => v.user)
  visits: Visit[];

  @OneToMany(() => BankAccount, (b) => b.user)
  bankAccounts: BankAccount[];

  @OneToMany(() => RefreshToken, (r) => r.user)
  refreshTokens: RefreshToken[];
}
