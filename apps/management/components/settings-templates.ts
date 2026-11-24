import { DOCUMENT_TYPE_FEATURE, type TemplateDocumentType as DocumentType } from '@campuspilot/api/routers/school/document/document.dto';
import type { SchoolFeatureKey } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';

/** One template page under Settings › Templates. */
export type SettingsTemplate = {
  id: string;
  label: string;
  /** The page's address below the school, for `schoolHref`. */
  path: string;
  documentType: DocumentType;
  /** The school feature the template belongs to (`DOCUMENT_TYPE_FEATURE`), its own fact per template. */
  feature: SchoolFeatureKey;
  /** Finance templates are read with the finance template permission, the others with the academic one. */
  finance: boolean;
};

const template = (id: string, label: string, slug: string, documentType: DocumentType, finance = false): SettingsTemplate => ({
  id: `${id}-template`,
  label,
  path: `/settings/templates/${slug}`,
  documentType,
  feature: DOCUMENT_TYPE_FEATURE[documentType],
  finance,
});

/** Every settings template, in the order the sidebar lists them. */
export const SETTINGS_TEMPLATES: readonly SettingsTemplate[] = [
  template('examination', 'Examination', 'examination', 'report_card'),
  template('id-card', 'ID card', 'id-card', 'id_card'),
  template('admit-card', 'Admit card', 'admit-card', 'admit_card'),
  template('timetable', 'Timetable', 'timetable', 'timetable'),
  template('bill', 'Bill', 'bill', 'bill', true),
  template('receipt', 'Receipt', 'receipt', 'receipt', true),
  template('statement', 'Statement', 'statement', 'statement', true),
  template('notice', 'Notice', 'notice', 'notice'),
  template('question-paper', 'Question paper', 'question-paper', 'question_paper'),
];

/**
 * The settings template of a document type. Every type has exactly one
 * (`settings-templates.test.ts` checks the list is exhaustive); its slug is a
 * human-facing name that predates the API enum, so it is looked up here, never
 * derived from the type.
 */
export function settingsTemplateOf(documentType: DocumentType): SettingsTemplate {
  const found = SETTINGS_TEMPLATES.find((candidate) => candidate.documentType === documentType);
  if (!found) throw new Error(`No settings template for document type ${documentType}`);
  return found;
}

/**
 * The first template the school has, or null when it has none. The Templates
 * entry of the settings sidebar and the Templates command of the search both
 * open it, so neither points at a template of a feature the school lacks
 * (a school without student management opens the question paper's, or the
 * notice's, whichever it has) and neither is offered when there is none.
 */
export function firstSettingsTemplate(has: (feature: SchoolFeatureKey) => boolean): SettingsTemplate | null {
  return SETTINGS_TEMPLATES.find(({ feature }) => has(feature)) ?? null;
}
