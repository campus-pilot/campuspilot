import { CLASS_ACTIONS } from '@campuspilot/opa/policies/class';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { buildLearnPayload } from '@campuspilot/question-paper/guide';

import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { checkPermissions } from '../../../permissions/authorization';
import { requireClassPermission } from '../../../permissions/class';
import { requireSchoolPermission } from '../../../permissions/school';
import * as dto from './question-paper.dto';
import { QUESTION_PAPER_LEARN_OUTPUT_CHARS, QUESTION_PAPER_PAPER_OUTPUT_CHARS } from './question-paper.dto';
import { buildQuestionPaperContext } from './question-paper.context';
import { requireQuestionPaperAssistantAccess } from './question-paper.access';
import { findPaper, templateMissingError } from './question-paper.records';
import { renderQuestionPaperBody, renderQuestionPaperDocument, selectedQuestionPaperTemplate } from './question-paper.render';
import { resolvePaperScope } from './question-paper.scope';
import {
  deleteQuestionPaper,
  deleteQuestionPaperPage,
  getQuestionPaper,
  getQuestionPaperDetail,
  listQuestionPaperVersions,
  listQuestionPapers,
  reorderQuestionPaperPages,
  startQuestionPaperGeneration,
} from './question-paper.service';
import {
  checkQuestionPaperDraft,
  downloadVersionPdf,
  findChatDraftContent,
  getVersion,
  renderStoredVersionHtml,
  saveQuestionPaperVersion,
} from './question-paper.version.service';

const route = (summary: string, description: string) => ({ summary, description, tags: ['School', 'Question papers'] });

/**
 * A question paper tool as the assistant and MCP clients see it. All of them
 * are `advanced` (the core listing is a fixed, tested budget) in the `exams`
 * module, which the in-app assistant already may use. The ones that return a
 * whole paper or the guide declare a larger `outputChars` so the model is not
 * handed a truncated document (design G6).
 */
const tool = (access: 'read' | 'write', options: { destructive?: boolean; outputChars?: number } = {}) =>
  ({
    mcp: {
      exposure: 'advanced',
      access,
      destructive: options.destructive ?? false,
      module: 'exams',
      ...(options.outputChars ? { outputChars: options.outputChars } : {}),
    },
  }) as const;
/** Human actions: still on RPC and OpenAPI, never offered to MCP clients or the assistant (D44). */
const humanOnly = (access: 'read' | 'write', destructive = false) =>
  ({ mcp: { exposure: 'hidden', access, destructive, module: 'exams' } }) as const;


const readClass = requireClassPermission(CLASS_ACTIONS.READ_EXAM_QUESTION_PAPERS);
const manageClass = requireClassPermission(CLASS_ACTIONS.MANAGE_EXAM_QUESTION_PAPERS);

const userId = (context: { session: { user: { id: string } } | null }) => {
  const id = context.session?.user.id;
  if (!id) throw rpcError.unauthorized();
  return id;
};

/**
 * Question papers (decisions D2, D4-D9, D18, D26, D37, D43, D44; design E).
 *
 * Every procedure checks, in this order: the OPA class permission
 * (`class.exam.question_paper.read` / `.manage`; a teacher only for their own
 * classes), then the AI assistant gate (`requireQuestionPaperAssistantAccess`:
 * the school has the feature and one of the user's roles may use the
 * assistant), and only then looks at the paper. Writes also need the active
 * session and an exam that has not ended.
 */
export const schoolQuestionPaperRouter = {
  listQuestionPapers: protectedProcedure
    .route(route('List question papers', "For one exam, every class you may read with its subjects and assessment modes (from the exam plans) and, for each, whether a paper exists: its page count, latest version number, notices and any running or failed AI generation. Use this to find the ids that the other question paper tools take."))
    .meta(tool('read'))
    .input(dto.listQuestionPapersInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_PLANS))
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.listQuestionPapersOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await listQuestionPapers(context.db, input, async (classIds) => {
          const requests = classIds.flatMap((classId) =>
            [CLASS_ACTIONS.READ_EXAM_QUESTION_PAPERS, CLASS_ACTIONS.MANAGE_EXAM_QUESTION_PAPERS].map((action) => ({
              action,
              resource: { kind: 'class' as const, schoolId: input.schoolId, classId },
            })),
          );
          const decisions = await checkPermissions(context, requests, signal);
          const read = new Set<string>();
          const manage = new Set<string>();
          classIds.forEach((classId, index) => {
            if (decisions[index * 2]) read.add(classId);
            if (decisions[index * 2 + 1]) manage.add(classId);
          });
          return { read, manage };
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getQuestionPaper: protectedProcedure
    .route(route('Get a question paper', "Read one paper: the uploaded pages, its latest version number (latestVersionNo, the expectedVersionNo to pass to saveQuestionPaperVersion; 0 when there is none) and the HTML fragment (html) of its latest or a named version with any notices about what the sanitiser removed. Call learn_question_paper_generation before editing the html."))
    .meta(tool('read', { outputChars: QUESTION_PAPER_PAPER_OUTPUT_CHARS }))
    .input(dto.getQuestionPaperInputSchema)
    .use(readClass)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.getQuestionPaperOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await getQuestionPaper(context.db, await resolvePaperScope(context.db, input), input.versionNo);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listQuestionPaperVersions: protectedProcedure
    .route(route('List question paper versions', 'List the saved versions of one paper, newest first (at most 100): number, who and what wrote it (the AI job or a chat agent), notice count and whether a PDF is stored.'))
    .meta(tool('read'))
    .input(dto.paperKeySchema)
    .use(readClass)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.listVersionsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await listQuestionPaperVersions(context.db, await resolvePaperScope(context.db, input));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  learn_question_paper_generation: protectedProcedure
    .route(route('Learn question paper generation', 'Call this first whenever you are going to write, check, edit or save a question paper. Returns the rules for the HTML fragment a question paper is written in (vocabulary, formulas as data-math, figures, scripts, and the ban on animation), the limits and one complete example that validateQuestionPaperDraft and saveQuestionPaperVersion accept. It reads no school data.'))
    .meta(tool('read', { outputChars: QUESTION_PAPER_LEARN_OUTPUT_CHARS }))
    .input(dto.learnInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAMS))
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.learnOutputSchema)
    .handler(async () => {
      return buildLearnPayload();
    }),

  validateQuestionPaperDraft: protectedProcedure
    .route(route('Validate a question paper draft', 'Call learn_question_paper_generation first. Check a draft question paper (an HTML fragment) without saving anything. Returns valid, the problems you must fix (a limit exceeded, a formula KaTeX rejects, an unusable figure id, an empty paper), stripped (what the sanitiser removed from your html, for example a style it does not accept) and a draftId. When valid the app shows the user a preview of the draft.'))
    .meta(tool('read', { outputChars: QUESTION_PAPER_PAPER_OUTPUT_CHARS }))
    .input(dto.validateDraftInputSchema)
    .use(readClass)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.validateDraftOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const scope = await resolvePaperScope(context.db, input);
        // Attachments of the chat user are valid figures inside the in-app assistant and when that same person's browser
        // session re-checks a draft card (the same rule as previewQuestionPaperDraft); never for API keys or OAuth clients.
        const chatUserId = context.principal.authMethod === 'assistant' || context.principal.authMethod === 'session' ? userId(context) : undefined;
        const checked = await checkQuestionPaperDraft(context.db, scope, input.html, { chatUserId });
        if (!checked.ok) {
          return { valid: false, problems: checked.problems, stripped: checked.stripped, draftId: null, placeholderFigures: 0, characters: input.html.length };
        }
        return {
          valid: true,
          problems: [],
          stripped: checked.stripped,
          draftId: checked.draftId,
          placeholderFigures: checked.placeholderFigures,
          characters: checked.characters,
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  saveQuestionPaperVersion: protectedProcedure
    .route(route('Save a question paper version', "Call learn_question_paper_generation first. Save a question paper as a NEW version (an existing version is never edited); the user is asked to approve this. Send the HTML as html, or the draftId of a draft you validated earlier in this chat. expectedVersionNo must be latestVersionNo from getQuestionPaper (0 for a first version); if the paper changed meanwhile the call fails with CONFLICT. Only save when the user asked you to. Figures you cannot provide stay <figure data-placeholder> placeholders. The PDF is printed with the school's question paper template."))
    .meta(tool('write'))
    .input(dto.saveVersionInputSchema)
    .use(manageClass)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.saveVersionOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const user = userId(context);
        const scope = await resolvePaperScope(context.db, input);
        const chat = context.principal.authMethod === 'assistant' ? context.principal.assistantRun : null;
        let html = input.html;
        if (input.draftId !== undefined && input.html !== undefined) {
          throw rpcError.badRequest('Send exactly one of html or draftId, not both.');
        }
        if (input.draftId !== undefined) {
          if (!chat) throw rpcError.badRequest('A draftId can only be used from the in-app assistant. Send the full html instead.');
          html = await findChatDraftContent(context.db, { conversationId: chat.conversationId, schoolId: input.schoolId, userId: user, draftId: input.draftId });
        }
        const saved = await saveQuestionPaperVersion(context.db, {
          scope,
          userId: user,
          expectedVersionNo: input.expectedVersionNo,
          html: html!,
          source: { kind: 'agent', conversationId: chat?.conversationId ?? null },
          signal,
        });
        const { replayed: _replayed, ...result } = saved;
        return result;
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  startQuestionPaperGeneration: protectedProcedure
    .route(route('Generate a question paper with AI', "Start the AI reading the uploaded page photos and writing the HTML paper. It runs in the background and saves a new version when it finishes; poll getQuestionPaperDetail. expectedPageRevision must be the pageRevision you last saw. Refused when there are no pages, a page is in a format the model cannot read, a generation is already running, the school has no question paper template, or the school's AI limit is reached."))
    .meta(humanOnly('write'))
    .input(dto.startGenerationInputSchema)
    .use(manageClass)
    .use(requireQuestionPaperAssistantAccess({ useModel: true }))
    .output(dto.startGenerationOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await startQuestionPaperGeneration(context.db, {
          scope: await resolvePaperScope(context.db, input),
          userId: userId(context),
          expectedPageRevision: input.expectedPageRevision,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getQuestionPaperDetail: protectedProcedure
    .route(route('Get the question paper screen', "Everything the Question paper screen shows for one paper: pages, any running generation, the last finished generation with its failure message, the version list and whether the school has chosen a template. The screen polls this while a generation runs."))
    .meta(humanOnly('read'))
    .input(dto.paperKeySchema)
    .use(readClass)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.detailOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await getQuestionPaperDetail(context.db, await resolvePaperScope(context.db, input));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  reorderQuestionPaperPages: protectedProcedure
    .route(route('Reorder question paper pages', 'Set the order of a paper\'s uploaded pages. pageIds must list every page once; expectedPageRevision must be the revision you last saw (CONFLICT otherwise). Refused while a generation runs.'))
    .meta(humanOnly('write'))
    .input(dto.reorderPagesInputSchema)
    .use(manageClass)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.reorderPagesOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await reorderQuestionPaperPages(context.db, {
          scope: await resolvePaperScope(context.db, input),
          pageIds: input.pageIds,
          expectedPageRevision: input.expectedPageRevision,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteQuestionPaperPage: protectedProcedure
    .route(route('Delete a question paper page', 'Delete one uploaded page photo and renumber the rest. expectedPageRevision must be the revision you last saw. Refused while a generation runs.'))
    .meta(humanOnly('write', true))
    .input(dto.deletePageInputSchema)
    .use(manageClass)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.deletePageOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await deleteQuestionPaperPage(context.db, {
          scope: await resolvePaperScope(context.db, input),
          pageId: input.pageId,
          expectedPageRevision: input.expectedPageRevision,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteQuestionPaper: protectedProcedure
    .route(route('Delete a question paper', 'Delete a paper with its uploaded pages, figure images, every version and every stored PDF. This cannot be undone. Refused while a generation runs.'))
    .meta(humanOnly('write', true))
    .input(dto.paperKeySchema)
    .use(manageClass)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.deletePaperOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await deleteQuestionPaper(context.db, { scope: await resolvePaperScope(context.db, input) });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getQuestionPaperPreview: protectedProcedure
    .route(route('Preview a question paper version', "Render a saved version to sanitised, network-free HTML exactly as its PDF is printed: with the template revision pinned when it was saved, so an old version never changes when the school edits its template."))
    .meta(humanOnly('read'))
    .input(dto.versionNoInputSchema)
    .use(readClass)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.previewOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const scope = await resolvePaperScope(context.db, input);
        const paper = await findPaper(context.db, scope.key);
        if (!paper) throw rpcError.notFound('Question paper');
        const version = await getVersion(context.db, paper.id, input.versionNo);
        const { html, templateName } = await renderStoredVersionHtml(context.db, scope, version);
        return { html, warnings: version.warnings, templateName };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  previewQuestionPaperDraft: protectedProcedure
    .route(route('Preview a question paper draft', "Render an unsaved question paper (an HTML fragment) with the school's currently selected template. Returns the problems instead when the draft is not valid. Saves nothing."))
    .meta(humanOnly('read'))
    .input(dto.previewDraftInputSchema)
    .use(readClass)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.previewDraftOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const scope = await resolvePaperScope(context.db, input);
        // A person previewing a draft from their own chat may see their attachments as figures.
        const chatUserId = userId(context);
        const checked = await checkQuestionPaperDraft(context.db, scope, input.html, { chatUserId });
        if (!checked.ok) return { html: '', problems: checked.problems, warnings: [], templateName: null };
        const template = await selectedQuestionPaperTemplate(context.db, input.schoolId);
        if (!template) throw templateMissingError();
        const paper = await findPaper(context.db, scope.key);
        const body = await renderQuestionPaperBody(context.db, { schoolId: input.schoolId, paperId: paper?.id ?? null, html: checked.html, chatUserId });
        const rendered = await buildQuestionPaperContext(context.db, scope, { versionNo: null });
        return {
          html: renderQuestionPaperDocument({ template, context: rendered, body }),
          problems: [],
          warnings: checked.notices,
          templateName: template.name,
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getQuestionPaperDownload: protectedProcedure
    .route(route('Download a question paper version', "Issue a five-minute download URL for the PDF of a saved version. If its stored PDF was removed, the version is printed again from its content and pinned template first."))
    .meta(humanOnly('read'))
    .input(dto.versionNoInputSchema)
    .use(readClass)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.downloadOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const scope = await resolvePaperScope(context.db, input);
        const paper = await findPaper(context.db, scope.key);
        if (!paper) throw rpcError.notFound('Question paper');
        const version = await getVersion(context.db, paper.id, input.versionNo);
        const file = await downloadVersionPdf(context.db, { scope, version, userId: userId(context), signal });
        return { ...file, expiresIn: 300 };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};

