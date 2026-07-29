import { msg } from '@lingui/core/macro';
import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type UpdateOneResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  RecordCrudException,
  RecordCrudExceptionCode,
} from 'src/engine/core-modules/record-crud/exceptions/record-crud.exception';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { isDefined } from 'twenty-shared/utils';

type PvStageValue =
  | 'NEW'
  | 'CONTACTED'
  | 'SQS'
  | 'CONVERSATION'
  | 'MEETING_SCHEDULED'
  | 'MEETING_COMPLETED'
  | 'SQL'
  | 'OPPORTUNITY'
  | 'CLOSED_WON'
  | 'LOST';

const ALLOWED_NEXT_STAGE: Record<PvStageValue, PvStageValue[]> = {
  NEW: ['CONTACTED'],
  CONTACTED: ['SQS'],
  SQS: ['CONVERSATION'],
  CONVERSATION: ['MEETING_SCHEDULED'],
  MEETING_SCHEDULED: ['MEETING_COMPLETED'],
  MEETING_COMPLETED: ['SQL'],
  SQL: ['OPPORTUNITY'],
  OPPORTUNITY: ['CLOSED_WON'],
  CLOSED_WON: [],
  LOST: [],
};

const isPvStageValue = (value: unknown): value is PvStageValue => {
  if (!isDefined(value) || typeof value !== 'string') {
    return false;
  }

  return (
    value === 'NEW' ||
    value === 'CONTACTED' ||
    value === 'SQS' ||
    value === 'CONVERSATION' ||
    value === 'MEETING_SCHEDULED' ||
    value === 'MEETING_COMPLETED' ||
    value === 'SQL' ||
    value === 'OPPORTUNITY' ||
    value === 'CLOSED_WON' ||
    value === 'LOST'
  );
};

@WorkspaceQueryHook(`opportunity.updateOne`)
export class OpportunityPvStageUpdateOnePreQueryHook
  implements WorkspacePreQueryHookInstance
{
  constructor(
    private readonly findRecordsService: FindRecordsService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateOneResolverArgs,
  ): Promise<UpdateOneResolverArgs> {
    const updatedPvStage = payload.data?.pvStage;

    if (!isDefined(updatedPvStage)) {
      return payload;
    }

    if (!isPvStageValue(updatedPvStage)) {
      throw new RecordCrudException(
        'Invalid pvStage value',
        RecordCrudExceptionCode.INVALID_REQUEST,
        {
          userFriendlyMessage: msg`Invalid PV stage value.`,
        },
      );
    }

    const toolOutput = await this.findRecordsService.execute({
      objectName: 'opportunity',
      filter: { id: { eq: payload.id } },
      limit: 1,
      authContext,
      shouldBuildEffectiveSelectFields: false,
    });

    if (!toolOutput.success || !toolOutput.result?.records?.length) {
      throw new RecordCrudException(
        'Opportunity not found',
        RecordCrudExceptionCode.RECORD_NOT_FOUND,
      );
    }

    const recordBefore = toolOutput.result.records[0] as {
      pvStage?: unknown;
      amount?: unknown;
      closeDate?: unknown;
    };

    const pvStageBeforeRaw = recordBefore.pvStage;

    if (!isPvStageValue(pvStageBeforeRaw)) {
      throw new RecordCrudException(
        'Missing pvStage value on record',
        RecordCrudExceptionCode.INVALID_REQUEST,
        {
          userFriendlyMessage: msg`This opportunity has an invalid PV stage.`,
        },
      );
    }

    const pvStageBefore = pvStageBeforeRaw;
    const pvStageAfter = updatedPvStage;

    if (pvStageBefore === pvStageAfter) {
      return payload;
    }

    // Lost is reachable from any stage.
    if (pvStageAfter === 'LOST') {
      if (!isDefined(recordBefore.closeDate)) {
        throw new RecordCrudException(
          'Missing required fields for LOST',
          RecordCrudExceptionCode.INVALID_REQUEST,
          {
            userFriendlyMessage: msg`Close date is required to mark the opportunity as Lost.`,
          },
        );
      }

      return payload;
    }

    const allowedNext = ALLOWED_NEXT_STAGE[pvStageBefore];

    if (!allowedNext.includes(pvStageAfter)) {
      throw new RecordCrudException(
        'Invalid pvStage transition',
        RecordCrudExceptionCode.INVALID_REQUEST,
        {
          userFriendlyMessage: msg`Invalid PV stage transition.`,
        },
      );
    }

    const requiresAmountAndCloseDateForFinancialStages = new Set<
      PvStageValue
    >(['SQL', 'OPPORTUNITY', 'CLOSED_WON']);

    if (requiresAmountAndCloseDateForFinancialStages.has(pvStageAfter)) {
      const missingFields: string[] = [];

      if (!isDefined(recordBefore.amount)) {
        missingFields.push('amount');
      }

      if (!isDefined(recordBefore.closeDate)) {
        missingFields.push('closeDate');
      }

      if (missingFields.length > 0) {
        throw new RecordCrudException(
          'Missing required fields for PV stage',
          RecordCrudExceptionCode.INVALID_REQUEST,
          {
            userFriendlyMessage: msg`Missing required fields: ${missingFields.join(', ')}`,
          },
        );
      }
    }

    return payload;
  }
}

