import { IsEnum, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '../../../common/enums';

export class InitializeDepositDto {
  @ApiProperty({
    description: 'Deposit amount in kobo. Minimum 1,500,000 kobo (15,000 NGN)',
    example: 1500000,
    minimum: 1500000,
  })
  @IsInt()
  @Min(1500000)
  amount: number;

  @ApiProperty({
    description: 'Payment method for the deposit',
    enum: PaymentMethod,
    example: PaymentMethod.CARD,
  })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}
