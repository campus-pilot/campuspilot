import { annotateTiming, measure } from '@campuspilot/logger/perf';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { buildStandaloneLearnPayload } from '@campuspilot/question-paper/guide';
import type { QuestionPaperDetails } from '@campuspilot/question-paper/details';

import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { requireSchoolPermission } from '../../../permissions/school';
import { requireQuestionPaperAssistantAccess } from '../question-paper/question-paper.access';
import { chatFiguresOf } from '../question-paper/question-paper.attachments';
import { conversationRefOf } from '../question-paper/question-paper.conversations';
import {
  QUESTION_PAPER_DRAFT_OUTPUT_CHARS,
  QUESTION_PAPER_LEARN_OUTPUT_CHARS,
  QUESTION_PAPER_PAPER_OUTPUT_CHARS,
  QUESTION_PAPER_VALIDATE_OUTPUT_CHARS,
  deletePageOutputSchema,
  deletePaperOutputSchema,
  downloadOutputSchema,
  learnOutputSchema,
  listVersionsOutputSchema,
  previewDraftOutputSchema,
  previewOutputSchema,
  releasePageOutputSchema,
  reorderPagesOutputSchema,
  reservePagesOutputSchema,
  rotatePageOutputSchema,
  startGenerationOutputSchema,
  validateDraftOutputSchema,
} from '../question-paper/question-paper.dto';
import { applyQuestionPaperEdits } from '../question-paper/question-paper.edits';
import { leanLines } from '../question-paper/question-paper.lean';
import { findPaperOf } from '../question-paper/question-paper.records';
import { renderQuestionPaperBody, renderStandaloneQuestionPaperDocument } from '../question-paper/question-paper.render';
import { sanitizeQuestionPaperBody } from '../question-paper/question-paper.sanitize';
import { resolveStandalonePaper, type StandalonePaperScope } from '../question-paper/question-paper.scope';
import {
  deleteQuestionPaper,
  deleteQuestionPaperPage,
  listQuestionPaperVersions,
  releaseQuestionPaperPage,
  reorderQuestionPaperPages,
  reserveQuestionPaperPages,
  rotateQuestionPaperPage,
  startQuestionPaperGeneration,
} from '../question-paper/question-paper.service';
import { STANDALONE_QUESTION_PAPER_PRINTS } from '../question-paper/question-paper.standalone-shell';
import {
  checkQuestionPaperDraft,
  cleanedChatDraft,
  downloadVersionPdf,
  findChatDraftContent,
  getVersion,
  renderStoredVersionHtml,
  saveQuestionPaperVersion,
  type SavedVersion,
} from '../question-paper/question-paper.version.service';
import * as dto from './standalone-paper.dto';
import {
  createStandalonePaper,
  getStandalonePaper,
  getStandalonePaperDetail,
  getStandalonePaperFacts,
  listStandalonePaperFilterOptions,
  listStandalonePapers,
} from './standalone-paper.service';

const route = (summary: string, description: string) => ({ summary, description, tags: ['School', 'Question papers'] });

/**
 * Every standalone paper procedure serves personal spaces only
 * (docs/personal-space.md): `requireAuth` refuses them for a real school, and
 * refuses every real-school procedure for a personal space.
 */
const PERSONAL_ONLY = ['personal'] as const;

/**
 * A standalone paper tool as the assistant and MCP clients see it: like the
 * exam paper tools (`advanced`, module `exams`, larger `outputChars` for
 * results that hold a whole paper, saves without an approval card).
 */
const tool = (access: 'read' | 'write', options: { destructive?: boolean; outputChars?: number; skipsApproval?: true } = {}) =>
  ({
    mcp: {
      exposure: 'advanced',
      access,
      destructive: options.destructive ?? false,
      module: 'exams',
      ...(options.outputChars ? { outputChars: options.outputChars } : {}),
      ...(options.skipsApproval ? { skipsApproval: true as const } : {}),
    },
    schoolKinds: PERSONAL_ONLY,
  }) as const;
/** Human actions: on RPC and OpenAPI, never offered to MCP clients or the assistant, as for exam papers. */
const humanOnly = (access: 'read' | 'write', destructive = false) =>
  ({ mcp: { exposure: 'hidden', access, destructive, module: 'exams' }, schoolKinds: PERSONAL_ONLY }) as const;

const readPapers = requireSchoolPermission(SCHOOL_ACTIONS.READ_STANDALONE_PAPERS);
const managePapers = requireSchoolPermission(SCHOOL_ACTIONS.MANAGE_STANDALONE_PAPERS);

const userId = (context: { session: { user: { id: string } } | null }) => {
  const id = context.session?.user.id;
  if (!id) throw rpcError.unauthorized();
  return id;
};

/** The paper the input names, in its school, or NOT_FOUND. */
const resolve = (context: { db: Parameters<typeof resolveStandalonePaper>[0] }, input: { schoolId: string; paperId: string }) =>
  resolveStandalonePaper(context.db, { schoolId: input.schoolId, paperId: input.paperId });

/** A save's result as the standalone tools answer it (a standalone paper has no plan maximum). */
const saveResult = ({ replayed: _replayed, planMaxMarks: _planMaxMarks, ...result }: SavedVersion) => result;

/** The conversation reference of a resolved standalone paper. */
const chatOf = (scope: StandalonePaperScope) => conversationRefOf(scope);

/**
 * Standalone question papers of a personal space (docs/personal-space.md).
 * Every procedure checks, in this order: the personal space school kind
 * (`requireAuth`), the school permission (`school.standalone_paper.read` /
 * `.manage`), the AI assistant gate (`requireQuestionPaperAssistantAccess`),
 * and only then looks at the paper. There is no session, exam lifecycle or
 * template to require: the paper prints in the built-in plain shell. Pages,
 * generation, drafts and versions are the exam papers' own services with a
 * standalone scope.
 */
export const schoolStandalonePaperRouter = {
  listStandalonePapers: protectedProcedure
    .route(route('List standalone question papers', "The question papers of the user's personal space, most recently changed first, with their details (school, class, subject and exam as the paper prints them), page count, latest version number and any running or failed AI generation. searchQuery matches any detail; filters match one detail exactly (values from listStandalonePaperFilterOptions)."))
    .meta(tool('read'))
    .input(dto.listStandalonePapersInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.listStandalonePapersOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await listStandalonePapers(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listStandalonePaperFilterOptions: protectedProcedure
    .route(route('List standalone paper filter values', 'The distinct school, class, subject and exam names the papers of this personal space state, sorted: the values listStandalonePapers filters by.'))
    .meta(tool('read'))
    .input(dto.listStandalonePaperFilterOptionsInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.listStandalonePaperFilterOptionsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await listStandalonePaperFilterOptions(context.db, input.schoolId);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  createStandalonePaper: protectedProcedure
    .route(route('Create a standalone question paper', 'Create an empty question paper in the personal space and return its paperId. Write it with saveStandalonePaperVersion (after learn_standalone_question_paper).'))
    .meta(tool('write'))
    .input(dto.createStandalonePaperInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.createStandalonePaperOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await createStandalonePaper(context.db, { schoolId: input.schoolId, userId: userId(context) });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getStandalonePaper: protectedProcedure
    .route(route('Get a standalone question paper', "Read one paper of the personal space: its details, uploaded pages, latest version number (latestVersionNo, the expectedVersionNo for a save; 0 when there is none) and the HTML fragment (html) of its latest or a named version. templatePrints is always empty: nothing is printed around this paper, so it carries its own heading. Call learn_standalone_question_paper before writing or editing it."))
    .meta(tool('read', { outputChars: QUESTION_PAPER_PAPER_OUTPUT_CHARS }))
    .input(dto.getStandalonePaperInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.getStandalonePaperOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await getStandalonePaper(context.db, await resolve(context, input), input.versionNo);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getStandalonePaperDraft: protectedProcedure
    .route(route('Get a standalone question paper draft', 'In-app assistant only. Read back the html of a draft you validated earlier in this chat and have not saved, by its draftId (from validateStandalonePaperDraft), with the facts of its paper (latestVersionNo is the expectedVersionNo for a save). It changes nothing.'))
    .meta(tool('read', { outputChars: QUESTION_PAPER_DRAFT_OUTPUT_CHARS }))
    .input(dto.getStandalonePaperDraftInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.getStandalonePaperDraftOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const user = userId(context);
        const chat = context.principal.authMethod === 'assistant' ? context.principal.assistantRun : null;
        if (!chat) throw rpcError.badRequest('A draft can only be read by the in-app assistant. You already have the html you wrote; use getStandalonePaper for a saved paper.');
        const scope = await resolve(context, input);
        const raw = await findChatDraftContent(context.db, { conversationId: chat.conversationId, paper: chatOf(scope), userId: user, draftId: input.draftId });
        const draft = cleanedChatDraft(raw);
        const paper = await getStandalonePaperFacts(context.db, scope);
        return { paper, templatePrints: STANDALONE_QUESTION_PAPER_PRINTS, draftId: draft.draftId, html: draft.html, characters: draft.html.length };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listStandalonePaperVersions: protectedProcedure
    .route(route('List standalone question paper versions', 'List the saved versions of one paper of the personal space, newest first (at most 100): number, who and what wrote it, notice count and whether a PDF is stored.'))
    .meta(tool('read'))
    .input(dto.standalonePaperRefSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(listVersionsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await listQuestionPaperVersions(context.db, await resolve(context, input));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  learn_standalone_question_paper: protectedProcedure
    .route(route('Learn standalone question paper writing', "Call this first whenever you are going to write, check, edit or save a question paper of a personal space. Returns the rules for the HTML fragment (vocabulary, formulas as data-math, figures, scripts, the ban on animation), why the paper carries its own heading, the details every save sends, the limits and one complete example. It reads no school data."))
    .meta(tool('read', { outputChars: QUESTION_PAPER_LEARN_OUTPUT_CHARS }))
    .input(dto.learnStandalonePaperInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(learnOutputSchema)
    .handler(async () => buildStandaloneLearnPayload()),

  validateStandalonePaperDraft: protectedProcedure
    .route(route('Validate a standalone question paper draft', 'Call learn_standalone_question_paper first. Check a draft paper (an HTML fragment, heading included) without saving anything. Returns valid, the problems you must fix, stripped (what the sanitiser removed) and a draftId. When valid the app shows the user a preview of the draft.'))
    .meta(tool('read', { outputChars: QUESTION_PAPER_VALIDATE_OUTPUT_CHARS }))
    .input(dto.validateStandalonePaperDraftInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(validateDraftOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const scope = await resolve(context, input);
        // As for exam papers: chat attachments are figures inside the in-app assistant and a person's draft card only.
        const principal = context.principal;
        const chatConversationId = principal.authMethod === 'assistant' ? principal.assistantRun.conversationId : input.conversationId;
        const chat =
          principal.authMethod === 'assistant' || principal.authMethod === 'session'
            ? await chatFiguresOf(context.db, { userId: userId(context), conversationId: chatConversationId, paper: chatOf(scope) })
            : undefined;
        const checked = await checkQuestionPaperDraft(context.db, scope, input.html, { chat });
        if (!checked.ok) {
          return { valid: false, problems: leanLines(checked.problems), stripped: leanLines(checked.stripped), draftId: null, placeholderFigures: 0, characters: input.html.length };
        }
        return {
          valid: true,
          problems: [],
          stripped: leanLines(checked.stripped),
          draftId: checked.draftId,
          placeholderFigures: checked.placeholderFigures,
          characters: checked.characters,
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  saveStandalonePaperVersion: protectedProcedure
    .route(route('Save a standalone question paper version', "Call learn_standalone_question_paper first. Save the paper as a NEW version (the previous one stays). Send the HTML as html, or the draftId of a draft you validated earlier in this chat, with expectedVersionNo = latestVersionNo from getStandalonePaper (0 for a first version; CONFLICT if the paper changed meanwhile) and details: the school, class, subject and exam the paper prints, which replace the paper's details. In the in-app chat, save a valid draft straight away without asking the user first. The PDF is printed on a plain A4 page."))
    .meta(tool('write', { skipsApproval: true }))
    .input(dto.saveStandalonePaperVersionInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.saveStandalonePaperVersionOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const user = userId(context);
        const scope = await resolve(context, input);
        const chat = context.principal.authMethod === 'assistant' ? context.principal.assistantRun : null;
        if (input.draftId !== undefined && input.html !== undefined) throw rpcError.badRequest('Send exactly one of html or draftId, not both.');
        let html = input.html;
        if (input.draftId !== undefined) {
          if (!chat) throw rpcError.badRequest('A draftId can only be used from the in-app assistant. Send the full html instead.');
          html = await findChatDraftContent(context.db, { conversationId: chat.conversationId, paper: chatOf(scope), userId: user, draftId: input.draftId });
        }
        const details: QuestionPaperDetails = input.details;
        const saved = await saveQuestionPaperVersion(context.db, {
          scope,
          userId: user,
          expectedVersionNo: input.expectedVersionNo,
          html: html!,
          source: { kind: 'agent', conversationId: chat?.conversationId ?? null },
          details,
          signal,
        });
        return saveResult(saved);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  editStandalonePaper: protectedProcedure
    .route(route('Edit a standalone question paper', "Call learn_standalone_question_paper first. Change part of a saved paper of the personal space and save the result as a NEW version, without writing the whole paper again. Each edit's find is text copied exactly from the html getStandalonePaper returned for expectedVersionNo (its latestVersionNo), long enough to occur once; replace is the new text. Edits apply in order, all or nothing. Also send details (school, class, subject, exam as the edited paper prints them): they replace the paper's details."))
    .meta(tool('write', { skipsApproval: true }))
    .input(dto.editStandalonePaperInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.saveStandalonePaperVersionOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const scope = await resolve(context, input);
        const { version } = await getStandalonePaper(context.db, scope, input.expectedVersionNo);
        if (!version) throw rpcError.notFound('Question paper version');
        const edited = applyQuestionPaperEdits(version.html, input.edits);
        if (!edited.ok) throw rpcError.badRequest(`Nothing was saved. ${edited.problems.join(' ')}`);
        const chat = context.principal.authMethod === 'assistant' ? context.principal.assistantRun : null;
        const saved = await saveQuestionPaperVersion(context.db, {
          scope,
          userId: userId(context),
          expectedVersionNo: input.expectedVersionNo,
          html: edited.html,
          source: { kind: 'agent', conversationId: chat?.conversationId ?? null },
          details: input.details,
          signal,
        });
        return saveResult(saved);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  startStandalonePaperGeneration: protectedProcedure
    .route(route('Generate a standalone question paper with AI', "Start the AI reading the uploaded page photos and writing the whole paper, heading included, changed as the optional instructions ask. It runs in the background, saves a new version with the paper's details when it finishes; poll getStandalonePaperDetail. expectedPageRevision must be the pageRevision you last saw. Refused when there are no pages, a page cannot be read, a generation is already running or the school's AI limit is reached."))
    .meta(humanOnly('write'))
    .input(dto.startStandalonePaperGenerationInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess({ useModel: true }))
    .output(startGenerationOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await startQuestionPaperGeneration(context.db, {
          scope: await resolve(context, input),
          userId: userId(context),
          expectedPageRevision: input.expectedPageRevision,
          instructions: input.instructions ?? null,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getStandalonePaperDetail: protectedProcedure
    .route(route('Get the standalone question paper screen', 'Everything the paper screen of a personal space shows: details, pages, any running generation, the last finished generation with its failure message, the version list and the latest shared conversation. Polled while a generation runs.'))
    .meta(humanOnly('read'))
    .input(dto.standalonePaperRefSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.standalonePaperDetailOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await getStandalonePaperDetail(context.db, await resolve(context, input));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  reorderStandalonePaperPages: protectedProcedure
    .route(route('Reorder standalone question paper pages', "Set the order of a paper's uploaded pages. pageIds must list every page once; expectedPageRevision must be the revision you last saw (CONFLICT otherwise). Refused while a generation runs."))
    .meta(humanOnly('write'))
    .input(dto.reorderStandalonePaperPagesInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(reorderPagesOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await reorderQuestionPaperPages(context.db, { scope: await resolve(context, input), pageIds: input.pageIds, expectedPageRevision: input.expectedPageRevision });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  reserveStandalonePaperPages: protectedProcedure
    .route(route('Reserve standalone question paper pages', 'Reserve the next pages of a paper, one per photo about to be uploaded, in the order given; each photo is then sent to its own page (POST .../standalone-papers/{paperId}/pages/{pageId}). Refused when the paper would pass 20 pages or a generation runs.'))
    .meta(humanOnly('write'))
    .input(dto.reserveStandalonePaperPagesInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(reservePagesOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await reserveQuestionPaperPages(context.db, { scope: await resolve(context, input), userId: userId(context), fileNames: input.fileNames });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  releaseStandalonePaperPage: protectedProcedure
    .route(route('Release a reserved standalone question paper page', 'Remove a reserved page whose photo never arrived and renumber the rest. A page that has its photo is deleted with deleteStandalonePaperPage instead.'))
    .meta(humanOnly('write', true))
    .input(dto.releaseStandalonePaperPageInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(releasePageOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await releaseQuestionPaperPage(context.db, { scope: await resolve(context, input), pageId: input.pageId });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteStandalonePaperPage: protectedProcedure
    .route(route('Delete a standalone question paper page', 'Delete one uploaded page photo and renumber the rest. expectedPageRevision must be the revision you last saw. Refused while a generation runs.'))
    .meta(humanOnly('write', true))
    .input(dto.deleteStandalonePaperPageInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(deletePageOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await deleteQuestionPaperPage(context.db, { scope: await resolve(context, input), pageId: input.pageId, expectedPageRevision: input.expectedPageRevision });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  rotateStandalonePaperPage: protectedProcedure
    .route(route('Turn a standalone question paper page', "Turn one uploaded page photo to a rotation (0, 90, 180 or 270 clockwise degrees on top of the photo's own orientation). expectedPageRevision must be the revision you last saw; a turn bumps it. Refused while a generation runs and for a photo the server cannot read (HEIC)."))
    .meta(humanOnly('write'))
    .input(dto.rotateStandalonePaperPageInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(rotatePageOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await rotateQuestionPaperPage(context.db, {
          scope: await resolve(context, input),
          pageId: input.pageId,
          rotation: input.rotation,
          expectedPageRevision: input.expectedPageRevision,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteStandalonePaper: protectedProcedure
    .route(route('Delete a standalone question paper', 'Delete a paper of the personal space with its uploaded pages, figure images, every version and every stored PDF. This cannot be undone. Refused while a generation runs.'))
    .meta(humanOnly('write', true))
    .input(dto.standalonePaperRefSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(deletePaperOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await deleteQuestionPaper(context.db, { scope: await resolve(context, input) });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getStandalonePaperPreview: protectedProcedure
    .route(route('Preview a standalone question paper version', 'Render a saved version to sanitised, network-free HTML exactly as its PDF is printed, on the plain A4 page.'))
    .meta(humanOnly('read'))
    .input(dto.standalonePaperVersionNoInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(previewOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const scope = await resolve(context, input);
        const version = await getVersion(context.db, scope.paperId, input.versionNo);
        const { html, templateName } = await renderStoredVersionHtml(context.db, scope, version);
        const placeholderFigures = measure('qp.preview.placeholders', () => sanitizeQuestionPaperBody(version.contentHtml).stats.placeholders);
        annotateTiming({ paperId: scope.paperId, versionNo: version.versionNo, htmlBytes: Buffer.byteLength(html, 'utf8') });
        return { html, warnings: version.warnings, placeholderFigures, templateName };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  previewStandalonePaperDraft: protectedProcedure
    .route(route('Preview a standalone question paper draft', 'Render an unsaved paper (an HTML fragment) on the plain A4 page. Returns the problems instead when the draft is not valid. Saves nothing.'))
    .meta(humanOnly('read'))
    .input(dto.previewStandalonePaperDraftInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(previewDraftOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const scope = await resolve(context, input);
        // A person previewing a draft sees as figures their own attachments and those of the paper's chat it is from.
        const chat = await chatFiguresOf(context.db, { userId: userId(context), conversationId: input.conversationId, paper: chatOf(scope) });
        const checked = await checkQuestionPaperDraft(context.db, scope, input.html, { chat });
        if (!checked.ok) return { html: '', problems: checked.problems, warnings: [], placeholderFigures: 0, templateName: null };
        const paper = await findPaperOf(context.db, scope);
        const body = await renderQuestionPaperBody(context.db, { schoolId: input.schoolId, paperId: paper?.id ?? null, html: checked.html, chat });
        const html = renderStandaloneQuestionPaperDocument(body);
        annotateTiming({ paperId: scope.paperId, htmlBytes: Buffer.byteLength(html, 'utf8') });
        return { html, problems: [], warnings: checked.notices, placeholderFigures: checked.placeholderFigures, templateName: null };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getStandalonePaperDownload: protectedProcedure
    .route(route('Download a standalone question paper version', 'Issue a five-minute download URL for the PDF of a saved version. If its stored PDF was removed, the version is printed again first.'))
    .meta(humanOnly('read'))
    .input(dto.standalonePaperVersionNoInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(downloadOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const scope = await resolve(context, input);
        const version = await getVersion(context.db, scope.paperId, input.versionNo);
        const file = await downloadVersionPdf(context.db, { scope, version, userId: userId(context), signal });
        return { ...file, expiresIn: 300 };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
