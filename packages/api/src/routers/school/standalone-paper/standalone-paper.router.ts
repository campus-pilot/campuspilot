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
import { findPaperOf, templateMissingError } from '../question-paper/question-paper.records';
import { buildPaperContext } from '../question-paper/question-paper.print-context';
import {
  renderQuestionPaperBody,
  renderQuestionPaperDocument,
  renderStandaloneQuestionPaperDocument,
  selectedQuestionPaperTemplate,
} from '../question-paper/question-paper.render';
import { sanitizeQuestionPaperBody } from '../question-paper/question-paper.sanitize';
import { printLayoutOf, type StandalonePaperScope } from '../question-paper/question-paper.scope';
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
import { readTemplatePrints } from '../question-paper/question-paper.template-prints';
import {
  checkQuestionPaperDraft,
  cleanedChatDraft,
  downloadVersion,
  findChatDraftContent,
  getVersion,
  renderStoredVersionHtml,
  saveQuestionPaperVersion,
  type SavedVersion,
} from '../question-paper/question-paper.version.service';
import * as dto from './standalone-paper.dto';
import { STANDALONE_PAPERS_PER_SPACE_LIMIT } from './standalone-paper.dto';
import {
  createStandalonePaper,
  getStandalonePaper,
  getStandalonePaperDetail,
  getStandalonePaperFacts,
  listStandalonePaperFilterOptions,
  listStandalonePapers,
} from './standalone-paper.service';
import { resolveReachedStandalonePaper, standalonePaperReachOf } from './standalone-paper.reach';

const route = (summary: string, description: string) => ({ summary, description, tags: ['School', 'Question papers'] });

/**
 * Every standalone paper procedure serves both kinds of school: a personal
 * space's papers (docs/personal-space.md) and a real school's quick papers
 * (docs/question-papers.md "Quick papers in a school"). What differs between
 * them is a fact of the paper (`print_layout`), never of the procedure.
 */
const EVERY_KIND = ['school', 'personal'] as const;

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
    schoolKinds: EVERY_KIND,
  }) as const;
/** Human actions: on RPC and OpenAPI, never offered to MCP clients or the assistant, as for exam papers. */
const humanOnly = (access: 'read' | 'write', destructive = false) =>
  ({ mcp: { exposure: 'hidden', access, destructive, module: 'exams' }, schoolKinds: EVERY_KIND }) as const;

const readPapers = requireSchoolPermission(SCHOOL_ACTIONS.READ_STANDALONE_PAPERS);
const managePapers = requireSchoolPermission(SCHOOL_ACTIONS.MANAGE_STANDALONE_PAPERS);

const userId = (context: { session: { user: { id: string } } | null }) => {
  const id = context.session?.user.id;
  if (!id) throw rpcError.unauthorized();
  return id;
};

/** The paper the input names, in its school, that the caller reaches (their own, or any with `oversee`), or NOT_FOUND. */
const resolve = resolveReachedStandalonePaper;

/** A save's result as the standalone tools answer it (a standalone paper has no plan maximum). */
const saveResult = ({ replayed: _replayed, planMaxMarks: _planMaxMarks, ...result }: SavedVersion) => result;

/** The conversation reference of a resolved standalone paper. */
const chatOf = (scope: StandalonePaperScope) => conversationRefOf(scope);

/**
 * Standalone question papers: a personal space's papers (docs/personal-space.md)
 * and a real school's quick papers (docs/question-papers.md "Quick papers in a
 * school"). Every procedure checks, in this order: the school kind
 * (`requireAuth`, both kinds), the school permission
 * (`school.standalone_paper.read` / `.manage`), the AI assistant gate
 * (`requireQuestionPaperAssistantAccess`: the school's `assistant` feature and
 * the caller's role), and only then looks at the paper, which the caller must
 * reach (their own, or any with `school.standalone_paper.oversee`). There is no
 * exam lifecycle to require. A personal space's paper prints in the built-in
 * plain shell; a quick paper prints with the school's selected template.
 * Pages, generation, drafts and versions are the exam papers' own services
 * with a standalone scope.
 */
export const schoolStandalonePaperRouter = {
  listStandalonePapers: protectedProcedure
    .route(route('List quick question papers', "The quick question papers (papers not tied to an exam plan) of the school or personal space that you can open: your own, or every one when you oversee them. Most recently changed first, with their details (school, class, subject, exam and maximum marks as the paper states them), page count, latest version number and any running or failed AI generation. searchQuery matches any name; filters match one name exactly (values from listStandalonePaperFilterOptions)."))
    .meta(tool('read'))
    .input(dto.listStandalonePapersInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.listStandalonePapersOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await listStandalonePapers(context.db, input, await standalonePaperReachOf(context, input.schoolId, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listStandalonePaperFilterOptions: protectedProcedure
    .route(route('List quick paper filter values', 'The distinct school, class, subject and exam names the quick papers you can open state, sorted: the values listStandalonePapers filters by.'))
    .meta(tool('read'))
    .input(dto.listStandalonePaperFilterOptionsInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.listStandalonePaperFilterOptionsOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await listStandalonePaperFilterOptions(context.db, input.schoolId, await standalonePaperReachOf(context, input.schoolId, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  createStandalonePaper: protectedProcedure
    .route(route('Create a quick question paper', `Get a quick question paper (not tied to an exam plan) to write and return its paperId: an unused paper of yours the school already has (no pages, versions or conversation; reused true), or a new one. In a school, sessionId is the academic session the paper belongs to (its template prints it); a personal space takes none and holds at most ${STANDALONE_PAPERS_PER_SPACE_LIMIT} papers. Write it with saveStandalonePaperVersion (after learn_standalone_question_paper).`))
    .meta(tool('write'))
    .input(dto.createStandalonePaperInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.createStandalonePaperOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await createStandalonePaper(context.db, { schoolId: input.schoolId, userId: userId(context), sessionId: input.sessionId ?? null });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getStandalonePaper: protectedProcedure
    .route(route('Get a quick question paper', "Read one quick paper: its details, uploaded pages, latest version number (latestVersionNo, the expectedVersionNo for a save; 0 when there is none), the HTML fragment (html) of its latest or a named version, and templatePrints: the text lines printed around the paper. In a school they are the school's template heading and footer (a value in square brackets such as [class] is a detail the paper does not state yet), so the paper leaves those facts out; in a personal space they are empty and the paper carries its whole heading. Call learn_standalone_question_paper before writing or editing it."))
    .meta(tool('read', { outputChars: QUESTION_PAPER_PAPER_OUTPUT_CHARS }))
    .input(dto.getStandalonePaperInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.getStandalonePaperOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await getStandalonePaper(context.db, await resolve(context, input, signal), input.versionNo);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getStandalonePaperDraft: protectedProcedure
    .route(route('Get a quick question paper draft', 'In-app assistant only. Read back the html of a draft you validated earlier in this chat and have not saved, by its draftId (from validateStandalonePaperDraft), with the facts of its paper (latestVersionNo is the expectedVersionNo for a save). It changes nothing.'))
    .meta(tool('read', { outputChars: QUESTION_PAPER_DRAFT_OUTPUT_CHARS }))
    .input(dto.getStandalonePaperDraftInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.getStandalonePaperDraftOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const user = userId(context);
        const chat = context.principal.authMethod === 'assistant' ? context.principal.assistantRun : null;
        if (!chat) throw rpcError.badRequest('A draft can only be read by the in-app assistant. You already have the html you wrote; use getStandalonePaper for a saved paper.');
        const scope = await resolve(context, input, signal);
        const raw = await findChatDraftContent(context.db, { conversationId: chat.conversationId, paper: chatOf(scope), userId: user, draftId: input.draftId });
        const draft = cleanedChatDraft(raw);
        const [paper, templatePrints] = await Promise.all([getStandalonePaperFacts(context.db, scope), readTemplatePrints(context.db, scope)]);
        return { paper, templatePrints, draftId: draft.draftId, html: draft.html, characters: draft.html.length };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listStandalonePaperVersions: protectedProcedure
    .route(route('List quick question paper versions', 'List the saved versions of one quick paper, newest first (at most 100): number, who and what wrote it, notice count and whether a PDF is stored.'))
    .meta(tool('read'))
    .input(dto.standalonePaperRefSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(listVersionsOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await listQuestionPaperVersions(context.db, await resolve(context, input, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  learn_standalone_question_paper: protectedProcedure
    .route(route('Learn quick question paper writing', "Call this first whenever you are going to write, check, edit or save a quick question paper (a paper of listStandalonePapers, not tied to an exam plan, in a school or a personal space). Returns the rules for the HTML fragment (vocabulary, formulas as data-math, figures, scripts, the ban on animation), how the heading works (in a school the school's template prints it; in a personal space the paper carries its own), the details every save sends, the limits and one complete example. It reads no school data."))
    .meta(tool('read', { outputChars: QUESTION_PAPER_LEARN_OUTPUT_CHARS }))
    .input(dto.learnStandalonePaperInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(learnOutputSchema)
    .handler(async () => buildStandaloneLearnPayload()),

  validateStandalonePaperDraft: protectedProcedure
    .route(route('Validate a quick question paper draft', "Call learn_standalone_question_paper first. Check a draft paper (an HTML fragment: in a personal space with its whole heading, in a school without what the school's template prints) without saving anything. Returns valid, the problems you must fix, stripped (what the sanitiser removed) and a draftId. When valid the app shows the user a preview of the draft."))
    .meta(tool('read', { outputChars: QUESTION_PAPER_VALIDATE_OUTPUT_CHARS }))
    .input(dto.validateStandalonePaperDraftInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(validateDraftOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const scope = await resolve(context, input, signal);
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
    .route(route('Save a quick question paper version', "Call learn_standalone_question_paper first. Save the paper as a NEW version (the previous one stays). Send the HTML as html, or the draftId of a draft you validated earlier in this chat, with expectedVersionNo = latestVersionNo from getStandalonePaper (0 for a first version; CONFLICT if the paper changed meanwhile) and details: the school, class, subject, exam and maximum marks the paper states, which replace the paper's details. In the in-app chat, save a valid draft straight away without asking the user first. In a school the PDF is printed with the school's template, which prints the class, subject, exam and maximum marks from these details; in a personal space on a plain A4 page."))
    .meta(tool('write', { skipsApproval: true }))
    .input(dto.saveStandalonePaperVersionInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.saveStandalonePaperVersionOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const user = userId(context);
        const scope = await resolve(context, input, signal);
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
    .route(route('Edit a quick question paper', "Call learn_standalone_question_paper first. Change part of a saved quick paper and save the result as a NEW version, without writing the whole paper again. Each edit's find is text copied exactly from the html getStandalonePaper returned for expectedVersionNo (its latestVersionNo), long enough to occur once; replace is the new text. Edits apply in order, all or nothing. Also send details (school, class, subject, exam and maximum marks as the edited paper states them): they replace the paper's details."))
    .meta(tool('write', { skipsApproval: true }))
    .input(dto.editStandalonePaperInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.saveStandalonePaperVersionOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const scope = await resolve(context, input, signal);
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
    .route(route('Generate a quick question paper with AI', "Start the AI reading the uploaded page photos and writing the paper (in a personal space with its whole heading; in a school without what the school's template prints), changed as the optional instructions ask. It runs in the background, saves a new version with the paper's details when it finishes; poll getStandalonePaperDetail. expectedPageRevision must be the pageRevision you last saw. Refused when there are no pages, a page cannot be read, a generation is already running, the school's AI limit is reached, or a school has selected no question paper template."))
    .meta(humanOnly('write'))
    .input(dto.startStandalonePaperGenerationInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess({ useModel: true }))
    .output(startGenerationOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await startQuestionPaperGeneration(context.db, {
          scope: await resolve(context, input, signal),
          userId: userId(context),
          expectedPageRevision: input.expectedPageRevision,
          instructions: input.instructions ?? null,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getStandalonePaperDetail: protectedProcedure
    .route(route('Get the quick question paper screen', "Everything a quick paper's screen shows: details, pages, any running generation, the last finished generation with its failure message, the version list and the latest shared conversation. Polled while a generation runs."))
    .meta(humanOnly('read'))
    .input(dto.standalonePaperRefSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.standalonePaperDetailOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await getStandalonePaperDetail(context.db, await resolve(context, input, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  reorderStandalonePaperPages: protectedProcedure
    .route(route('Reorder quick question paper pages', "Set the order of a paper's uploaded pages. pageIds must list every page once; expectedPageRevision must be the revision you last saw (CONFLICT otherwise). Refused while a generation runs."))
    .meta(humanOnly('write'))
    .input(dto.reorderStandalonePaperPagesInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(reorderPagesOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await reorderQuestionPaperPages(context.db, { scope: await resolve(context, input, signal), pageIds: input.pageIds, expectedPageRevision: input.expectedPageRevision });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  reserveStandalonePaperPages: protectedProcedure
    .route(route('Reserve quick question paper pages', 'Reserve the next pages of a paper, one per photo about to be uploaded, in the order given; each photo is then sent to its own page (POST .../standalone-papers/{paperId}/pages/{pageId}). Refused when the paper would pass 20 pages or a generation runs.'))
    .meta(humanOnly('write'))
    .input(dto.reserveStandalonePaperPagesInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(reservePagesOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await reserveQuestionPaperPages(context.db, { scope: await resolve(context, input, signal), userId: userId(context), fileNames: input.fileNames });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  releaseStandalonePaperPage: protectedProcedure
    .route(route('Release a reserved quick question paper page', 'Remove a reserved page whose photo never arrived and renumber the rest. A page that has its photo is deleted with deleteStandalonePaperPage instead.'))
    .meta(humanOnly('write', true))
    .input(dto.releaseStandalonePaperPageInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(releasePageOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await releaseQuestionPaperPage(context.db, { scope: await resolve(context, input, signal), pageId: input.pageId });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteStandalonePaperPage: protectedProcedure
    .route(route('Delete a quick question paper page', 'Delete one uploaded page photo and renumber the rest. expectedPageRevision must be the revision you last saw. Refused while a generation runs.'))
    .meta(humanOnly('write', true))
    .input(dto.deleteStandalonePaperPageInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(deletePageOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await deleteQuestionPaperPage(context.db, { scope: await resolve(context, input, signal), pageId: input.pageId, expectedPageRevision: input.expectedPageRevision });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  rotateStandalonePaperPage: protectedProcedure
    .route(route('Turn a quick question paper page', "Turn one uploaded page photo to a rotation (0, 90, 180 or 270 clockwise degrees on top of the photo's own orientation). expectedPageRevision must be the revision you last saw; a turn bumps it. Refused while a generation runs and for a photo the server cannot read (HEIC)."))
    .meta(humanOnly('write'))
    .input(dto.rotateStandalonePaperPageInputSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(rotatePageOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await rotateQuestionPaperPage(context.db, {
          scope: await resolve(context, input, signal),
          pageId: input.pageId,
          rotation: input.rotation,
          expectedPageRevision: input.expectedPageRevision,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteStandalonePaper: protectedProcedure
    .route(route('Delete a quick question paper', 'Delete a quick paper with its uploaded pages, figure images, every version and every stored PDF. This cannot be undone. Refused while a generation runs.'))
    .meta(humanOnly('write', true))
    .input(dto.standalonePaperRefSchema)
    .use(managePapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(deletePaperOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await deleteQuestionPaper(context.db, { scope: await resolve(context, input, signal) });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getStandalonePaperPreview: protectedProcedure
    .route(route('Preview a quick question paper version', "Render a saved version to sanitised, network-free HTML exactly as its PDF is printed: with the template revision it pinned in a school, on the plain A4 page in a personal space."))
    .meta(humanOnly('read'))
    .input(dto.standalonePaperVersionNoInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(previewOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const scope = await resolve(context, input, signal);
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
    .route(route('Preview a quick question paper draft', "Render an unsaved paper (an HTML fragment) as it would print: with the school's currently selected template and the paper's details in a school, on the plain A4 page in a personal space. Returns the problems instead when the draft is not valid. Saves nothing."))
    .meta(humanOnly('read'))
    .input(dto.previewStandalonePaperDraftInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(previewDraftOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const scope = await resolve(context, input, signal);
        // A person previewing a draft sees as figures their own attachments and those of the paper's chat it is from.
        const chat = await chatFiguresOf(context.db, { userId: userId(context), conversationId: input.conversationId, paper: chatOf(scope) });
        const checked = await checkQuestionPaperDraft(context.db, scope, input.html, { chat });
        if (!checked.ok) return { html: '', problems: checked.problems, warnings: [], placeholderFigures: 0, templateName: null };
        const paper = await findPaperOf(context.db, scope);
        const body = await renderQuestionPaperBody(context.db, { schoolId: input.schoolId, paperId: paper?.id ?? null, html: checked.html, chat });
        if (printLayoutOf(scope) === 'plain') {
          const html = renderStandaloneQuestionPaperDocument(body);
          annotateTiming({ paperId: scope.paperId, htmlBytes: Buffer.byteLength(html, 'utf8') });
          return { html, problems: [], warnings: checked.notices, placeholderFigures: checked.placeholderFigures, templateName: null };
        }
        // A quick paper previews as a save would print it: the school's selected template with the paper's details.
        const template = await selectedQuestionPaperTemplate(context.db, input.schoolId);
        if (!template) throw templateMissingError();
        const rendered = await measure('qp.context', () => buildPaperContext(context.db, scope, { versionNo: null }));
        const html = renderQuestionPaperDocument({ template, context: rendered, body });
        annotateTiming({ paperId: scope.paperId, htmlBytes: Buffer.byteLength(html, 'utf8') });
        return { html, problems: [], warnings: checked.notices, placeholderFigures: checked.placeholderFigures, templateName: template.name };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getStandalonePaperDownload: protectedProcedure
    .route(route('Download a quick question paper version', 'Issue a five-minute download URL for the PDF (default) or an editable Word file (format: docx) of a saved version. If its stored PDF was removed, the version is printed again first; the Word file is made on its first download and stored.'))
    .meta(humanOnly('read'))
    .input(dto.standalonePaperDownloadInputSchema)
    .use(readPapers)
    .use(requireQuestionPaperAssistantAccess())
    .output(downloadOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const scope = await resolve(context, input, signal);
        const version = await getVersion(context.db, scope.paperId, input.versionNo);
        const file = await downloadVersion(context.db, { scope, version, userId: userId(context), format: input.format, signal });
        return { ...file, expiresIn: 300 };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
