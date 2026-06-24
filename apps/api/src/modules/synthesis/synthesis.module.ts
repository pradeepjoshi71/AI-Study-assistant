import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConflictResolver } from './conflict-resolver';
import { SynthesisService } from './synthesis.service';

@Module({
  imports: [ConfigModule],
  providers: [ConflictResolver, SynthesisService],
  exports: [SynthesisService],
})
export class SynthesisModule {}
