import { IsNumber, IsOptional, Min, Max } from 'class-validator';

export class GeneratePlanDto {
  @IsNumber()
  @Min(30)
  @Max(480)
  timeAvailability!: number; // in minutes per day
}

export class CompleteTaskDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  score?: number; // optional score if completing a quiz/test task
}
