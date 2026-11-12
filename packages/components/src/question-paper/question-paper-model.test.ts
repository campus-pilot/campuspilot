import { describe, expect, it } from 'vitest';

import {
  cellStatus,
  editBlockedReason,
  formatMarks,
  formatPageSize,
  generateBlockedReason,
  isAcceptedImage,
  isHeifFile,
  movePageId,
  planUploads,
  QUESTION_PAPER_MAX_PAGE_BYTES,
} from './question-paper-model';

const file = (name: string, type: string, size = 1000) => ({ name, type, size });
const paper = (over: Partial<NonNullable<Parameters<typeof cellStatus>[0]>> = {}) => ({
  pageCount: 0,
  latestVersionNo: 0,
  totalMarks: null,
  planMaxMarks: 20,
  warningCount: 0,
  activeJob: null,
  lastJobFailure: null,
  ...over,
});

describe('upload planning', () => {
  it('accepts photo types by media type and by extension when the type is empty', () => {
    expect(isAcceptedImage(file('a.jpg', 'image/jpeg'))).toBe(true);
    expect(isAcceptedImage(file('IMG_1.HEIC', ''))).toBe(true);
    expect(isAcceptedImage(file('IMG_1.heif', 'application/octet-stream'))).toBe(true);
    expect(isAcceptedImage(file('a.gif', 'image/gif'))).toBe(false);
    expect(isAcceptedImage(file('notes.pdf', 'application/pdf'))).toBe(false);
    // A wrong declared type is not rescued by the name: the server compares both.
    expect(isAcceptedImage(file('a.jpg', 'application/pdf'))).toBe(false);
  });

  it('recognises HEIC by type or extension', () => {
    expect(isHeifFile(file('a.heic', 'image/heic'))).toBe(true);
    expect(isHeifFile(file('a.HEIF', ''))).toBe(true);
    expect(isHeifFile(file('a.jpg', 'image/jpeg'))).toBe(false);
  });

  it('refuses each file with its own reason and keeps the order of the rest', () => {
    const plan = planUploads(
      [
        file('1.jpg', 'image/jpeg'),
        file('big.png', 'image/png', QUESTION_PAPER_MAX_PAGE_BYTES + 1),
        file('2.png', 'image/png'),
        file('x.gif', 'image/gif'),
        file('empty.jpg', 'image/jpeg', 0),
        file('3.webp', 'image/webp'),
      ],
      2,
    );
    expect(plan.accepted.map((f) => f.name)).toEqual(['1.jpg', '2.png']);
    expect(plan.rejected).toEqual([
      { name: 'big.png', reason: 'The photo is larger than 15 MB.' },
      { name: 'x.gif', reason: 'Choose a JPEG, PNG, WebP or HEIC photo.' },
      { name: 'empty.jpg', reason: 'The file is empty.' },
      { name: '3.webp', reason: 'A paper holds at most 20 pages.' },
    ]);
  });

  it('accepts exactly 15 MiB and nothing when no slot is free', () => {
    expect(planUploads([file('a.jpg', 'image/jpeg', QUESTION_PAPER_MAX_PAGE_BYTES)], 1).accepted).toHaveLength(1);
    expect(planUploads([file('a.jpg', 'image/jpeg')], 0).accepted).toHaveLength(0);
    expect(planUploads([file('a.jpg', 'image/jpeg')], -3).accepted).toHaveLength(0);
  });
});

describe('cellStatus', () => {
  it('reads empty, pages, generating, failed, ready and warning in priority order', () => {
    expect(cellStatus(null).kind).toBe('empty');
    expect(cellStatus(paper()).kind).toBe('empty');
    expect(cellStatus(paper({ pageCount: 3 }))).toEqual({ kind: 'pages', label: '3 pages' });
    expect(cellStatus(paper({ pageCount: 1 })).label).toBe('1 page');
    expect(cellStatus(paper({ pageCount: 2, activeJob: { status: 'queued' } }))).toEqual({ kind: 'generating', label: 'Queued' });
    expect(cellStatus(paper({ activeJob: { status: 'running' }, lastJobFailure: { message: 'x' } })).label).toBe('Generating');
    expect(cellStatus(paper({ lastJobFailure: { message: 'The model refused.' }, latestVersionNo: 2 }))).toEqual({
      kind: 'failed',
      label: 'Generation failed',
      detail: 'The model refused.',
    });
    expect(cellStatus(paper({ latestVersionNo: 2, totalMarks: 20 }))).toEqual({
      kind: 'ready',
      label: 'Version 2',
      detail: '20 of 20 marks',
    });
    expect(cellStatus(paper({ latestVersionNo: 1, totalMarks: 18.5, warningCount: 1 }))).toEqual({
      kind: 'warning',
      label: 'Version 1 · 1 warning',
      detail: '18.5 of 20 marks',
    });
  });

  it('does not invent marks when the paper has none or the plan has no maximum', () => {
    expect(cellStatus(paper({ latestVersionNo: 1 })).detail).toBeUndefined();
    expect(cellStatus(paper({ latestVersionNo: 1, totalMarks: 10, planMaxMarks: null })).detail).toBe('10 marks');
  });
});

describe('page ordering', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('moves a page onto the position of another', () => {
    expect(movePageId(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(movePageId(ids, 'd', 'a')).toEqual(['d', 'a', 'b', 'c']);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });
  it('returns null when nothing moves', () => {
    expect(movePageId(ids, 'b', 'b')).toBeNull();
    expect(movePageId(ids, 'b', 'zz')).toBeNull();
  });
});

describe('blocked reasons', () => {
  it('names why editing is closed, completed exam first', () => {
    expect(editBlockedReason({ readOnly: true, canManage: false, jobActive: true })).toMatch(/has ended/);
    expect(editBlockedReason({ readOnly: false, canManage: false, jobActive: true })).toMatch(/not change/);
    expect(editBlockedReason({ readOnly: false, canManage: true, jobActive: true })).toMatch(/being generated/);
    expect(editBlockedReason({ readOnly: false, canManage: true, jobActive: false })).toBeNull();
  });
  it('names why generating is closed', () => {
    expect(generateBlockedReason({ pageCount: 0, templateConfigured: false, blockedReason: 'Closed.' })).toBe('Closed.');
    expect(generateBlockedReason({ pageCount: 0, templateConfigured: false, blockedReason: null })).toMatch(/at least one photo/);
    expect(generateBlockedReason({ pageCount: 2, templateConfigured: false, blockedReason: null })).toMatch(/template/);
    expect(generateBlockedReason({ pageCount: 2, templateConfigured: true, blockedReason: null })).toBeNull();
  });
  it('closes generating while photos upload, after the permission reason and before the page count', () => {
    expect(generateBlockedReason({ pageCount: 3, templateConfigured: true, blockedReason: null, uploading: true })).toBe('Wait for the photos to finish uploading.');
    expect(generateBlockedReason({ pageCount: 3, templateConfigured: true, blockedReason: 'Closed.', uploading: true })).toBe('Closed.');
    expect(generateBlockedReason({ pageCount: 0, templateConfigured: true, blockedReason: null, uploading: true })).toMatch(/finish uploading/);
    expect(generateBlockedReason({ pageCount: 3, templateConfigured: true, blockedReason: null, uploading: false })).toBeNull();
  });
});

describe('formatting', () => {
  it('formats marks and sizes', () => {
    expect(formatMarks(15)).toBe('15');
    expect(formatMarks(7.5)).toBe('7.5');
    expect(formatMarks(0.1 + 0.2)).toBe('0.3');
    expect(formatPageSize(512)).toBe('512 B');
    expect(formatPageSize(2048)).toBe('2 KB');
    expect(formatPageSize(2.4 * 1024 * 1024)).toBe('2.4 MB');
  });
});
