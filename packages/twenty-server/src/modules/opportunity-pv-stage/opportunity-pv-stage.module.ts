import { Module } from '@nestjs/common';

import { RecordCrudModule } from 'src/engine/core-modules/record-crud/record-crud.module';

import { OpportunityPvStageUpdateOnePreQueryHook } from './query-hooks/opportunity-pv-stage-update-one.pre-query.hook';

@Module({
  imports: [RecordCrudModule],
  providers: [OpportunityPvStageUpdateOnePreQueryHook],
})
export class OpportunityPvStageModule {}

