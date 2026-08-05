import { Command } from 'nest-commander';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { findFlatEntityByUniversalIdentifier } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier.util';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const PERSON_UNIVERSAL_IDENTIFIER =
  STANDARD_OBJECTS.person.universalIdentifier;

const SFDC_PERSON_FIELD_UNIVERSAL_IDENTIFIERS = [
  STANDARD_OBJECTS.person.fields.country.universalIdentifier,
  STANDARD_OBJECTS.person.fields.leadId.universalIdentifier,
  STANDARD_OBJECTS.person.fields.lead18Id.universalIdentifier,
  STANDARD_OBJECTS.person.fields.leadSource.universalIdentifier,
  STANDARD_OBJECTS.person.fields.swFitScore.universalIdentifier,
  STANDARD_OBJECTS.person.fields.street.universalIdentifier,
  STANDARD_OBJECTS.person.fields.rating.universalIdentifier,
  STANDARD_OBJECTS.person.fields.leadOwner.universalIdentifier,
  STANDARD_OBJECTS.person.fields.ownerDivision.universalIdentifier,
  STANDARD_OBJECTS.person.fields.roeSubDivision.universalIdentifier,
  STANDARD_OBJECTS.person.fields.createDate.universalIdentifier,
  STANDARD_OBJECTS.person.fields.lastActivityDate.universalIdentifier,
  STANDARD_OBJECTS.person.fields.emailAddressDomainTypeSfdc
    .universalIdentifier,
] as const;

@RegisteredWorkspaceCommand('2.23.0', 1784900000000)
@Command({
  name: 'upgrade:2-23:add-person-sfdc-lead-import-fields',
  description:
    'Add Salesforce lead-import fields on Person (exact CSV labels) for existing workspaces',
})
export class AddPersonSfdcLeadImportFieldsCommand extends ProvisionedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const isDryRun = options.dryRun ?? false;

    const { flatObjectMetadataMaps, flatFieldMetadataMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
      ]);

    const personObject = findFlatEntityByUniversalIdentifier<FlatObjectMetadata>(
      {
        flatEntityMaps: flatObjectMetadataMaps,
        universalIdentifier: PERSON_UNIVERSAL_IDENTIFIER,
      },
    );

    if (!isDefined(personObject)) {
      this.logger.log(
        `person object not found for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    const missingFieldUniversalIdentifiers =
      SFDC_PERSON_FIELD_UNIVERSAL_IDENTIFIERS.filter(
        (universalIdentifier) =>
          !isDefined(
            findFlatEntityByUniversalIdentifier<FlatFieldMetadata>({
              flatEntityMaps: flatFieldMetadataMaps,
              universalIdentifier,
            }),
          ),
      );

    if (missingFieldUniversalIdentifiers.length === 0) {
      this.logger.log(
        `All Salesforce Person import fields already present for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    if (isDryRun) {
      this.logger.log(
        `[DRY RUN] Would create ${missingFieldUniversalIdentifiers.length} Salesforce Person import field(s) for workspace ${workspaceId}`,
      );

      return;
    }

    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });

    const flatFieldMetadataToCreate: FlatFieldMetadata[] = [];

    for (const universalIdentifier of missingFieldUniversalIdentifiers) {
      const standardFlatFieldMetadata =
        standardAllFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
          universalIdentifier
        ];

      if (!isDefined(standardFlatFieldMetadata)) {
        this.logger.warn(
          `Standard field definition missing for ${universalIdentifier}, skipping that field`,
        );
        continue;
      }

      flatFieldMetadataToCreate.push({
        ...standardFlatFieldMetadata,
        viewFieldIds: [],
        viewFieldUniversalIdentifiers: [],
      });
    }

    if (flatFieldMetadataToCreate.length === 0) {
      this.logger.log(
        `No Salesforce Person import field definitions found to create for workspace ${workspaceId}`,
      );

      return;
    }

    const validateAndBuildResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunLegacyWorkspaceMigration(
        {
          allFlatEntityOperationByMetadataName: {
            fieldMetadata: {
              flatEntityToCreate: flatFieldMetadataToCreate,
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
          },
          workspaceId,
          isSystemBuild: true,
          applicationUniversalIdentifier:
            twentyStandardFlatApplication.universalIdentifier,
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      this.logger.error(
        `Failed to add Salesforce Person import fields for workspace ${workspaceId}:\n${JSON.stringify(
          validateAndBuildResult,
          null,
          2,
        )}`,
      );

      throw new Error(
        `Failed to add Salesforce Person import fields for workspace ${workspaceId}`,
      );
    }

    this.logger.log(
      `Added ${flatFieldMetadataToCreate.length} Salesforce Person import field(s) for workspace ${workspaceId}`,
    );
  }
}
