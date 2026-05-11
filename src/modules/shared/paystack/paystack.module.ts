import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaystackService } from './paystack.service';

@Module({
  imports: [HttpModule],
  providers: [PaystackService],
  exports: [PaystackService],
})
export class PaystackModule {}
