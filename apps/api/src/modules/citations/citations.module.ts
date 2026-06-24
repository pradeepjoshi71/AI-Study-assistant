import { Module } from '@nestjs/common';
import { CitationMapper } from './citation.mapper';

@Module({
  providers: [CitationMapper],
  exports: [CitationMapper],
})
export class CitationsModule {}
