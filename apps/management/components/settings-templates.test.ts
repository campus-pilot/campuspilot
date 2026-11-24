import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { documentTypeSchema } from '@campuspilot/api/routers/school/document/document.dto';
import type { SchoolFeatureKey } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { firstSettingsTemplate, SETTINGS_TEMPLATES, settingsTemplateOf } from './settings-templates';

const having = (...features: SchoolFeatureKey[]) => (feature: SchoolFeatureKey) => features.includes(feature);

describe('settings templates', () => {
  it('gives each template its own feature', () => {
    const features = Object.fromEntries(SETTINGS_TEMPLATES.map(({ id, feature }) => [id, feature]));
    assert.deepEqual(features, {
      'examination-template': 'studentManagement',
      'id-card-template': 'studentManagement',
      'admit-card-template': 'studentManagement',
      'timetable-template': 'studentManagement',
      'bill-template': 'studentManagement',
      'receipt-template': 'studentManagement',
      'statement-template': 'studentManagement',
      'notice-template': 'notices',
      'question-paper-template': 'assistant',
    });
  });

  it('opens the examination template for a school with student management', () => {
    assert.equal(firstSettingsTemplate(having('studentManagement', 'assistant'))?.path, '/settings/templates/examination');
  });

  it('opens the first template of a feature the school does have', () => {
    assert.equal(firstSettingsTemplate(having('assistant'))?.path, '/settings/templates/question-paper');
    // Decided from each template's own feature, not from which features happen to go together today.
    assert.equal(firstSettingsTemplate(having('notices', 'assistant'))?.path, '/settings/templates/notice');
  });

  it('has nothing to open for a school with none of the features', () => {
    assert.equal(firstSettingsTemplate(having()), null);
    assert.equal(firstSettingsTemplate(having('cadet')), null);
  });

  it('has exactly one template per document type, at its explicitly mapped address', () => {
    const types = SETTINGS_TEMPLATES.map(({ documentType }) => documentType);
    assert.deepEqual([...types].sort(), [...documentTypeSchema.options].sort());
    assert.equal(settingsTemplateOf('report_card').path, '/settings/templates/examination');
    assert.equal(settingsTemplateOf('id_card').path, '/settings/templates/id-card');
    assert.equal(settingsTemplateOf('question_paper').path, '/settings/templates/question-paper');
  });
});
