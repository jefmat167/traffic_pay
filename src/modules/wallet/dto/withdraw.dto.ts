import { IsInt, IsUUID, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WithdrawDto {
  @ApiProperty({
    description: 'Withdrawal amount in kobo. Minimum 500,000 kobo (5,000 NGN). Amounts over 10,000,000 kobo (100,000 NGN) require admin review',
    example: 500000,
    minimum: 500000,
  })
  @IsInt()
  @Min(500000)
  amount: number;

  @ApiProperty({
    description: 'UUID of the bank account to withdraw to',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    format: 'uuid',
  })
  @IsUUID()
  bankAccountId: string;
}
