import { describe, expect, it } from 'vitest';

import {
  applyModeFilter,
  cellStatus,
  MODE_FILTER_MAX_SLUGS,
  mergeModeSelection,
  modeFilterSchema,
  modeSelectionSchema,
  openClassOf,
  paperClassSummary,
  paperClassSummaryLabel,
  paperClassTriggerLabel,
  paperModeOptions,
  visibleModeSelection,
  editBlockedReason,
  isAcceptedImage,
  isHeifFile,
  movePageId,
  pageDragAnnouncements,
  planUploads,
  QUESTION_PAPER_MAX_PAGE_BYTES,
  versionSourceLabel,
} from './question-paper-model';

const file = (name: string, type: string, size = 1000) => ({ name, type, size });
const paper = (over: Partial<NonNullable<Parameters<typeof cellStatus>[0]>> = {}) => ({
  pageCount: 0,
  latestVersionNo: 0,
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
    expect(cellStatus(paper({ latestVersionNo: 2 }))).toEqual({ kind: 'ready', label: 'Version 2' });
    expect(cellStatus(paper({ latestVersionNo: 1, warningCount: 1 }))).toEqual({ kind: 'warning', label: 'Version 1 · 1 notice' });
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
    expect(editBlockedReason({ examCompleted: true, sessionActive: true, canManage: false, jobActive: true })).toMatch(/has ended/);
    expect(editBlockedReason({ examCompleted: false, sessionActive: false, canManage: true, jobActive: false })).toMatch(/not the active one/);
    expect(editBlockedReason({ examCompleted: true, sessionActive: false, canManage: true, jobActive: false })).toMatch(/has ended/);
    expect(editBlockedReason({ examCompleted: false, sessionActive: true, canManage: false, jobActive: true })).toMatch(/not change/);
    expect(editBlockedReason({ examCompleted: false, sessionActive: true, canManage: true, jobActive: true })).toMatch(/being generated/);
    expect(editBlockedReason({ examCompleted: false, sessionActive: true, canManage: true, jobActive: false })).toBeNull();
  });
});

describe('pageDragAnnouncements', () => {
  const say = pageDragAnnouncements([
    { id: 'qp_aaa', position: 1, originalName: 'front.jpg' },
    { id: 'qp_bbb', position: 2, originalName: 'back.jpg' },
  ]);
  it('speaks page numbers and file names, never ids', () => {
    expect(say.onDragStart({ active: { id: 'qp_bbb' } })).toBe('Picked up page 2, back.jpg.');
    expect(say.onDragOver({ active: { id: 'qp_bbb' }, over: { id: 'qp_aaa' } })).toBe('page 2, back.jpg is over position 1.');
    expect(say.onDragEnd({ active: { id: 'qp_bbb' }, over: { id: 'qp_aaa' } })).toBe('Dropped page 2, back.jpg at position 1.');
    expect(say.onDragEnd({ active: { id: 'qp_bbb' }, over: null })).toContain('unchanged');
    expect(say.onDragCancel({ active: { id: 'qp_bbb' } })).toContain('cancelled');
    expect(say.onDragStart({ active: { id: 'qp_zzz' } })).not.toContain('qp_');
  });
});

describe('versionSourceLabel', () => {
  it('names who wrote a version, including a copy of an earlier paper', () => {
    expect(versionSourceLabel('ai_job')).toBe('AI from photos');
    expect(versionSourceLabel('agent')).toBe('Assistant chat');
    expect(versionSourceLabel('copy')).toBe('Copied from an earlier paper');
  });
});

const mode = (modeSlug: string, modeName: string, over: Parameters<typeof paper>[0] | null = null) => ({
  modeSlug,
  modeName,
  paper: over === null ? null : paper(over),
});
const classes = [
  {
    classId: 'c1',
    className: 'Class 1',
    subjects: [
      { subjectSlug: 'english', subjectName: 'English', modes: [mode('written', 'Written', { latestVersionNo: 1 }), mode('oral', 'Oral')] },
      { subjectSlug: 'computer', subjectName: 'Computer', modes: [mode('practical', 'Practical', { activeJob: { status: 'running' } })] },
    ],
  },
  {
    classId: 'c2',
    className: 'Class 2',
    subjects: [{ subjectSlug: 'science', subjectName: 'Science', modes: [mode('theory', 'Theory', { lastJobFailure: { message: 'x' } }), mode('oral', 'Viva voce')] }],
  },
  { classId: 'c3', className: 'Class 3', subjects: [] },
];

describe('mode filter', () => {
  it('lists every distinct mode once, by name then slug, keeping the first name of a slug', () => {
    expect(paperModeOptions(classes)).toEqual([
      { slug: 'oral', name: 'Oral' },
      { slug: 'practical', name: 'Practical' },
      { slug: 'theory', name: 'Theory' },
      { slug: 'written', name: 'Written' },
    ]);
    expect(paperModeOptions([])).toEqual([]);
  });

  it('sorts equal names by slug so the order never depends on the data order', () => {
    const same = [{ classId: 'a', className: 'A', subjects: [{ subjectSlug: 's', subjectName: 'S', modes: [mode('b', 'Test'), mode('a', 'Test')] }] }];
    expect(paperModeOptions(same).map((option) => option.slug)).toEqual(['a', 'b']);
  });

  it('shows only stored slugs this examination has, in the options order', () => {
    const options = paperModeOptions(classes);
    expect(visibleModeSelection(['written', 'project', 'oral'], options)).toEqual(['oral', 'written']);
    expect(visibleModeSelection(['project'], options)).toEqual([]);
  });

  it('keeps stored slugs of other examinations, after the new choice, when the visible choice changes or is cleared', () => {
    const options = paperModeOptions(classes);
    expect(mergeModeSelection(['project', 'written'], options, ['oral', 'oral'])).toEqual(['oral', 'project']);
    expect(mergeModeSelection(['project', 'written'], options, [])).toEqual(['project']);
    // A choice that is not an option of this examination is not stored.
    expect(mergeModeSelection([], options, ['nonsense', 'theory'])).toEqual(['theory']);
  });

  it('never keeps more slugs than storage accepts, dropping the ones chosen longest ago', () => {
    const options = paperModeOptions(classes);
    const others = Array.from({ length: MODE_FILTER_MAX_SLUGS }, (_, index) => `other-${index}`);
    const merged = mergeModeSelection(others, options, ['written', 'oral']);
    expect(merged).toHaveLength(MODE_FILTER_MAX_SLUGS);
    // The choice just made is kept whole; the oldest stored slugs (last in the entry) go.
    expect(merged.slice(0, 3)).toEqual(['written', 'oral', 'other-0']);
    expect(merged).not.toContain(`other-${MODE_FILTER_MAX_SLUGS - 1}`);
    expect(merged).not.toContain(`other-${MODE_FILTER_MAX_SLUGS - 2}`);
    expect(modeFilterSchema.safeParse(merged).success).toBe(true);
    // An entry already over the limit (written before the cap) is brought back within it.
    expect(mergeModeSelection([...others, 'extra'], options, [])).toHaveLength(MODE_FILTER_MAX_SLUGS);
  });

  it('validates the form without the storage bounds, so a change is never rejected on screen', () => {
    const many = Array.from({ length: MODE_FILTER_MAX_SLUGS + 1 }, (_, index) => `mode-${index}`);
    expect(modeSelectionSchema.safeParse(many).success).toBe(true);
    expect(modeFilterSchema.safeParse(many).success).toBe(false);
  });

  it('shows every row for an empty selection', () => {
    const filtered = applyModeFilter(classes, []);
    expect(filtered.map((item) => item.subjects)).toEqual(classes.map((item) => item.subjects));
    expect(filtered.map((item) => item.emptyReason)).toEqual([null, null, 'no-subjects']);
  });

  it('keeps only the selected modes, drops subjects left empty and says why a class is empty', () => {
    const filtered = applyModeFilter(classes, ['theory']);
    expect(filtered.map((item) => item.classId)).toEqual(['c1', 'c2', 'c3']);
    expect(filtered[0]!.subjects).toEqual([]);
    expect(filtered[0]!.emptyReason).toBe('no-matching-modes');
    expect(filtered[1]!.subjects.map((subject) => subject.modes.map((item) => item.modeSlug))).toEqual([['theory']]);
    expect(filtered[1]!.emptyReason).toBeNull();
    // Empty by plan stays empty by plan, whatever the filter.
    expect(filtered[2]!.emptyReason).toBe('no-subjects');
  });

  it('filters across subjects with several selected modes', () => {
    const filtered = applyModeFilter(classes, ['oral', 'practical']);
    expect(filtered[0]!.subjects.map((subject) => [subject.subjectSlug, subject.modes.map((item) => item.modeSlug)])).toEqual([
      ['english', ['oral']],
      ['computer', ['practical']],
    ]);
  });
});

describe('class accordion', () => {
  it('summarises the rows a class shows', () => {
    expect(paperClassSummary(classes[0]!)).toEqual({ total: 3, ready: 1, generating: 1, failed: 0 });
    expect(paperClassSummaryLabel(paperClassSummary(classes[0]!))).toBe('1 of 3 ready · 1 generating');
    expect(paperClassSummaryLabel(paperClassSummary(classes[1]!))).toBe('0 of 2 ready · 1 failed');
    expect(paperClassSummaryLabel(paperClassSummary(classes[2]!))).toBe('0 of 0 ready');
  });

  it('names why a class with no rows is empty instead of "0 of 0 ready"', () => {
    const [emptied, , noSubjects] = applyModeFilter(classes, ['viva']);
    expect(paperClassSummary(emptied!).total).toBe(0);
    expect(paperClassTriggerLabel(emptied!)).toBe('No matching papers');
    expect(paperClassTriggerLabel(noSubjects!)).toBe('No subjects');
    const [shown] = applyModeFilter(classes, []);
    expect(paperClassTriggerLabel(shown!)).toBe('1 of 3 ready · 1 generating');
  });

  it('counts the filtered rows, not the whole class', () => {
    const [first] = applyModeFilter(classes, ['oral']);
    expect(paperClassSummary(first!)).toEqual({ total: 1, ready: 0, generating: 0, failed: 0 });
  });

  it('counts a version with notices as ready', () => {
    const noticed = { classId: 'n', className: 'N', subjects: [{ subjectSlug: 's', subjectName: 'S', modes: [mode('w', 'W', { latestVersionNo: 2, warningCount: 1 })] }] };
    expect(paperClassSummary(noticed).ready).toBe(1);
  });

  it('opens the class the parameter names only when it is in the list', () => {
    expect(openClassOf('c2', classes)).toBe('c2');
    expect(openClassOf('someone-else', classes)).toBeNull();
    expect(openClassOf('', classes)).toBeNull();
    expect(openClassOf(null, classes)).toBeNull();
    expect(openClassOf(undefined, classes)).toBeNull();
  });
});
