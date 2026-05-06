import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WithdrawalStatus } from '../../../common/enums';
import { bigintTransformer } from '../../../common/transformers/bigint.transformer';
import { User } from '../../users/entities/user.entity';
import { BankAccount } from './bank-account.entity';
import { Transaction } from './transaction.entity';

@Entity('withdrawals')
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  bankAccountId: string;

  @Column({ nullable: true })
  transactionId: string;

  @Column('bigint', { transformer: bigintTransformer })
  amount: number;

  @Column({
    type: 'enum',
    enum: WithdrawalStatus,
    default: WithdrawalStatus.PROCESSING,
  })
  status: WithdrawalStatus;

  @Column({ nullable: true })
  paystackTransferCode: string;

  @Column({ nullable: true })
  processedById: string;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date;

  @Column({ nullable: true })
  failureReason: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => BankAccount)
  @JoinColumn({ name: 'bankAccountId' })
  bankAccount: BankAccount;

  @OneToOne(() => Transaction)
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'processedById' })
  processedBy: User;
}
