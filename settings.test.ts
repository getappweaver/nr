import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import {
  createNrSettingsTable,
  getNrSettings,
  nrImageAgentSelection,
  resetNrSettings,
  saveNrSettings,
} from './settings';

test('image AI selection falls back through text AI to core defaults', () => {
  const db = new Database(':memory:');
  createNrSettingsTable(db);

  const defaults = getNrSettings(db);

  expect(nrImageAgentSelection(defaults)).toEqual({
    backend: null,
    model: null,
  });

  expect(
    nrImageAgentSelection({
      ...defaults,
      backend: 'cursor',
      model: 'text-model',
    }),
  ).toEqual({ backend: 'cursor', model: 'text-model' });

  expect(
    nrImageAgentSelection({
      ...defaults,
      backend: 'cursor',
      model: 'text-model',
      imageBackend: 'opencode',
      imageModel: 'image-model',
    }),
  ).toEqual({ backend: 'opencode', model: 'image-model' });

  db.close();
});

test('image AI overrides persist and reset independently', () => {
  const db = new Database(':memory:');
  createNrSettingsTable(db);

  const saved = saveNrSettings({
    ...getNrSettings(db),
    db,
    backend: 'cursor',
    model: 'text-model',
    imageBackend: 'opencode',
    imageModel: 'image-model',
  });

  expect(saved.imageBackend).toBe('opencode');
  expect(saved.imageModel).toBe('image-model');
  expect(saved.backend).toBe('opencode');
  expect(saved.model).toBe('text-model');

  const reset = resetNrSettings(db);

  expect(reset.imageBackend).toBeNull();
  expect(reset.imageModel).toBeNull();

  db.close();
});

test('mode defaults to LLM and Jev credentials stay out of settings views', () => {
  const db = new Database(':memory:');
  createNrSettingsTable(db);
  const initial = getNrSettings(db);
  expect(initial.mode).toBe('llm');
  expect(initial.jevHasApiKey).toBe(false);
  expect(initial.jevTopicBatchSize).toBe(10);

  const saved = saveNrSettings({
    ...initial,
    db,
    mode: 'classifier',
    jevApiKey: 'secret',
    jevTopicBatchSize: 20,
  });

  expect(saved.mode).toBe('classifier');
  expect(saved.jevHasApiKey).toBe(true);
  expect(getNrSettings(db).jevTopicBatchSize).toBe(20);
  expect(JSON.stringify(saved)).not.toContain('secret');
  expect(resetNrSettings(db).mode).toBe('llm');
  expect(getNrSettings(db).jevTopicBatchSize).toBe(10);
  expect(getNrSettings(db).jevHasApiKey).toBe(false);
  db.close();
});
