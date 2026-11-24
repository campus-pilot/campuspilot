import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { templateDocumentTypeSchema } from '@campuspilot/api/routers/school/document/document.dto';
import { templateManageAction, templateReadAction } from './template-permissions';

test('finance template types read and manage their templates with the finance permissions, every other type with the academic ones', () => {
  const finance = new Set(['bill', 'receipt', 'statement']);
  for (const type of templateDocumentTypeSchema.options) {
    assert.equal(
      templateReadAction(type),
      finance.has(type) ? SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES : SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES,
      type,
    );
    assert.equal(
      templateManageAction(type),
      finance.has(type) ? SCHOOL_ACTIONS.MANAGE_FINANCE_DOCUMENT_TEMPLATES : SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES,
      type,
    );
  }
});
