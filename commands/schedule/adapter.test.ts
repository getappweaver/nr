import { Database } from 'bun:sqlite';
import { expect, mock, test } from 'bun:test';

import { CapabilityResourceNotFoundError } from '@src/core/capabilities/errors';

import {
  createNrSettingsTable,
  getNrSchedulerResource,
  saveNrSchedulerResource,
} from '../../settings';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import { loadNrSchedulerV2 } from './adapter';

test('upgrades an existing scheduler v1 resource to the NR plugin tool', async () => {
  const db = new Database(':memory:');
  createNrSettingsTable(db);

  saveNrSchedulerResource(db, {
    capability: { name: 'scheduler', version: 1 },
    providerId: 'appweaver-job-plugin/scheduler/v1',
    resourceType: 'schedule',
    resourceId: 'resource-1',
  });

  const v2Resource = {
    capability: { name: 'scheduler', version: 2 },
    providerId: 'appweaver-job-plugin/scheduler/v2',
    resourceType: 'schedule',
    resourceId: 'resource-1',
  } as const;

  const invoke = mock(async (request: { operation: { id: string } }) => {
    if (request.operation.id === 'capability:v2:scheduler.show') {
      return {
        status: 'success' as const,
        provider: { providerId: v2Resource.providerId },
        output: {
          resource: v2Resource,
          status: 'created' as const,
          name: 'Nostr Radar fetch and evaluate',
          enabled: true,
          scheduleDescription: 'Hourly',
          nextRunAt: 1,
          task: {
            type: 'agent-prompt' as const,
            prompt: 'Run the NR CLI.',
            mode: 'agent' as const,
            workspaceTarget: 'appweaver' as const,
          },
          view: null,
        },
      };
    }

    return {
      status: 'success' as const,
      provider: { providerId: v2Resource.providerId },
      output: {
        resource: v2Resource,
        status: 'created' as const,
        name: 'Nostr Radar fetch and evaluate',
        enabled: true,
        scheduleDescription: 'Hourly',
        nextRunAt: 1,
        task: {
          type: 'plugin-tool' as const,
          alias: 'nr',
          toolName: 'fetch_evaluate',
          input: {},
        },
      },
    };
  });

  const output = await loadNrSchedulerV2({
    db,
    storedCtx: { capabilities: { invoke } },
  } as unknown as NrCommandAdapterParams);

  expect(output?.task).toEqual({
    type: 'plugin-tool',
    alias: 'nr',
    toolName: 'fetch_evaluate',
    input: {},
  });

  expect(invoke).toHaveBeenCalledTimes(2);
  expect(getNrSchedulerResource(db)?.capability.version).toBe(2);

  db.close();
});

test('clears a stale scheduler resource without failing settings', async () => {
  const db = new Database(':memory:');
  createNrSettingsTable(db);

  saveNrSchedulerResource(db, {
    capability: { name: 'scheduler', version: 2 },
    providerId: 'appweaver-job-plugin/scheduler/v2',
    resourceType: 'schedule',
    resourceId: 'deleted-resource',
  });

  const output = await loadNrSchedulerV2({
    db,
    storedCtx: {
      capabilities: {
        invoke: async () => {
          throw new CapabilityResourceNotFoundError(
            { name: 'scheduler', version: 2 },
            'deleted-resource',
          );
        },
      },
    },
  } as unknown as NrCommandAdapterParams);

  expect(output).toBeNull();
  expect(getNrSchedulerResource(db)).toBeNull();

  db.close();
});
