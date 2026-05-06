import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Withdrawal } from '../wallet/entities/withdrawal.entity';
import { WithdrawalStatus } from '../../common/enums';
import { PaystackService } from '../shared/paystack/paystack.service';

@Processor('withdrawal-processing')
export class WithdrawalProcessor extends WorkerHost {
  private readonly logger = new Logger(WithdrawalProcessor.name);

  constructor(
    @InjectRepository(Withdrawal) private withdrawalRepo: Repository<Withdrawal>,
    private paystackService: PaystackService,
  ) {
    super();
  }

  async process(job: Job<{ withdrawalId: string }>) {
    const { withdrawalId } = job.data;
    this.logger.log({ event: 'processing_withdrawal', withdrawalId });

    const withdrawal = await this.withdrawalRepo.findOne({
      where: { id: withdrawalId },
      relations: ['bankAccount'],
    });

    if (!withdrawal || withdrawal.status !== WithdrawalStatus.PROCESSING) {
      this.logger.warn({ event: 'withdrawal_skip', withdrawalId, reason: 'not found or not processing' });
      return;
    }

    try {
      const recipient = await this.paystackService.createTransferRecipient(
        withdrawal.bankAccount.bankCode,
        withdrawal.bankAccount.accountNumber,
        withdrawal.bankAccount.accountName,
      );

      const transfer = await this.paystackService.initiateTransfer(
        withdrawal.amount,
        recipient.recipient_code,
        'TrafficPay withdrawal',
      );

      await this.withdrawalRepo.update(withdrawal.id, {
        paystackTransferCode: transfer.transfer_code,
      });

      this.logger.log({ event: 'withdrawal_transfer_initiated', withdrawalId, transferCode: transfer.transfer_code });
    } catch (error) {
      this.logger.error({ event: 'withdrawal_transfer_failed', withdrawalId, error: error.message });
      throw error; // BullMQ will retry based on queue config
    }
  }
}
