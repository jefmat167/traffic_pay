import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteVisitDto {
  @ApiProperty({
    description: 'Client-reported visit duration in seconds (server-side timing is authoritative)',
    example: 65,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  clientDuration: number;
}
