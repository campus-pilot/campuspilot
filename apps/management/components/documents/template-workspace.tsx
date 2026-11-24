'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { Code2, FileText, PanelLeftClose, PanelLeftOpen, RefreshCw, Replace, Save, Sparkles, Store, X } from 'lucide-react';
import { z } from 'zod';
import { APP_SHELL_FILL_HEIGHT_MD_CLASS } from '@campuspilot/components/app-shell';
import type { AssistantEditorSource } from '@campuspilot/assistant-contract/template-editing';
import {
  adoptShownSource,
  draftBelongsTo,
  editorSourceOf,
  lastKnownSourceOf,
  sourceToSend,
  templateDraftStatusOf,
  type TemplateDraft,
} from '@campuspilot/components/documents/template-draft-model';
import type { TemplateDraftCardStatus } from '@campuspilot/components/documents/template-draft-card';
import { DocumentButton, DocumentErrors, DocumentField, DocumentSelect } from '@campuspilot/components/documents/document-controls';
import { OptionSelect } from '@campuspilot/components/option-select';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, useResizablePanelRef } from '@campuspilot/ui/components/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@campuspilot/ui/components/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { cn } from '@campuspilot/ui/lib/utils';
import { HALF_PAGE_DOCUMENT_TYPES } from '@campuspilot/api/routers/school/document/document.dto';

import { useAssistantGate } from '@/components/assistant/assistant-access';
import type { TemplateDraftBinding } from '@/components/assistant/assistant-template-draft';
import { client } from '@/lib/orpc';
import { confirmNavigation } from '@/lib/navigation-guard';

import { DocumentDirtyGuard, useDocumentCache, type ActiveTemplate, type DocumentTemplateScope } from './document-common';
import { noticePreviewPrintSizeSchema, noticePrintSizeOptions } from './notice-print-size-preview';
import { NewTemplateChatButton, TemplateAssistantPane, useTemplateChat } from './template-assistant';
import { TemplatePdfPreview } from './template-pdf-preview';
import { TemplatePromptEditor } from './template-prompt-editor';
import { AllRevisionsButton, RevisionHistoryDialog, RevisionPicker, RevisionPreview, useRevisionParam, useTemplateRevision } from './template-revisions';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { initialSaveFootprint } from './template-save-model';


const TemplateCodeEditor = dynamic(() => import('./template-code-editor').then((module) => module.TemplateCodeEditor), {
  ssr: false,
  loading: () => <div className="grid h-full min-h-96 place-items-center bg-card text-sm text-muted-foreground">Loading code editor…</div>,
});

type PageSize = 'full' | 'half';
/** The left pane's two tools: the assistant's chat and the code with its settings. */
type EditTool = 'ai' | 'code';
/** What a phone shows: one section at a time, as on the question paper studio. */
type MobileSection = 'preview' | 'code';
type PanelRef = ReturnType<typeof useResizablePanelRef>;

const halfPageDocumentTypes: ReadonlySet<string> = new Set(HALF_PAGE_DOCUMENT_TYPES);
/** The paper footprints, each with a title (what the closed select shows) and what it means. */
const PAGE_SIZE_OPTIONS: { value: PageSize; title: string; description: string }[] = [
  { value: 'half', title: 'Half A4', description: 'Two documents per sheet' },
  { value: 'full', title: 'Full A4', description: 'One document per sheet' },
];
/** The Save dialog's footprint choice; empty until chosen (`initialSaveFootprint`). */
const SAVE_FOOTPRINT_OPTIONS = [
  { value: '', label: 'Choose the paper footprint' },
  { value: 'half', label: 'Half A4 · two documents per sheet' },
  { value: 'full', label: 'Full A4 · one document per sheet' },
] as const;
/** From md up the editor and the preview sit side by side (the question paper studio's breakpoint). */
const SIDE_BY_SIDE_QUERY = '(min-width: 768px)';
/** How long typing pauses before the PDF preview is converted again (one Gotenberg conversion per preview). */
const PREVIEW_DEBOUNCE_MS = 900;

function subscribeToSideBySide(onChange: () => void) {
  const query = window.matchMedia(SIDE_BY_SIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** matchMedia as an external store, so the layout follows the window with no effect. */
function useSideBySide() {
  return useSyncExternalStore(subscribeToSideBySide, () => window.matchMedia(SIDE_BY_SIDE_QUERY).matches, () => false);
}

/**
 * The editor's state and its actions. The template on screen is derived from
 * facts kept apart (`editorSourceOf`): the person's own working copy and the
 * assistant's newest ready draft, so a draft that arrives in the chat is
 * shown at once, with no effect. A hand edit is never overwritten: a draft
 * that arrives after the person changed the template since sending their
 * message is held back (`source.held`) and offered as "Replace my edits".
 * Nothing is saved until Save, which goes through the same
 * `saveDocumentTemplate` as always and creates the immutable revision.
 */
function useTemplateEditor(scope: DocumentTemplateScope, template: ActiveTemplate, latest: TemplateDraft | null, onReload: () => Promise<void>) {
  const cache = useDocumentCache();
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const form = useForm({
    defaultValues: {
      name: template.artifact.name,
      /** The person's own working copy: the saved source until they edit, reload or show a draft. */
      content: template.content,
      pageSize: template.artifact.pageSize,
      /** Whether the person chose the working copy since the editor opened (edited it, reloaded, or showed a draft). */
      manual: false,
      /** The draft (its call id) that was the newest when they last chose; a newer draft is shown over their copy. */
      manualOver: null as string | null,
      /**
       * Whether they changed the working copy by hand (typing, Restore, Reload saved) since their last message
       * was sent: the snapshot taken at sending. A draft arriving after such a change is held, not shown.
       */
      editedSinceSend: false,
      /** The working copy the preview renders: it follows typing after a pause, so each keystroke is not a PDF. */
      previewContent: template.content,
      /** Notice designs only: the notice print size the preview renders at (not saved). */
      printSize: 'full' as PageSize,
      /**
       * The footprint chosen in the Save dialog, for types printed two-up:
       * empty (not chosen yet) when the dialog opened over HTML that differs
       * from the loaded revision (`initialSaveFootprint`). It becomes
       * `pageSize` when the person saves.
       */
      saveFootprint: '' as PageSize | '',
      error: '',
    },
    validators: {
      onChange: z.object({
        name: z.string().trim().min(1, 'Give this template a name').max(120),
        content: z.string().trim().min(1, 'Add template HTML').max(200_000),
        pageSize: z.enum(['full', 'half']),
        manual: z.boolean(),
        manualOver: z.string().nullable(),
        editedSinceSend: z.boolean(),
        previewContent: z.string(),
        printSize: noticePreviewPrintSizeSchema,
        saveFootprint: z.enum(['', 'full', 'half']),
        error: z.string(),
      }),
    },
    onSubmit: async ({ value }) => {
      form.setFieldValue('error', '');
      try {
        await client.school.saveDocumentTemplate({
          ...scope,
          name: value.name,
          content: value.content,
          pageSize: value.pageSize,
          expectedRevisionId: template.revisionId,
        });
        await cache.templates(scope);
      } catch (error) {
        form.setFieldValue('error', error instanceof Error ? error.message : 'Unable to update this template.');
      }
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const working = { content: values.content, edited: values.manual, over: values.manualOver, editedSinceSend: values.editedSinceSend };
  const source = editorSourceOf(working, latest);

  const cancelPreviewTimer = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
  };
  /** Makes `content` the working copy the person chose, over whatever draft is the newest now. */
  const choose = (content: string) => {
    form.setFieldValue('content', content);
    form.setFieldValue('manual', true);
    form.setFieldValue('manualOver', latest?.callId ?? null);
  };
  const editSource = (next: string) => {
    // Editing over a draft starts from that draft, so the preview keeps showing it until the pause is over.
    if (source.draft) form.setFieldValue('previewContent', source.content);
    if (source.held) {
      // Typing on while a draft is held keeps it held (and its "Replace my edits") until the person decides or sends.
      form.setFieldValue('content', next);
    } else {
      choose(next);
    }
    form.setFieldValue('editedSinceSend', true);
    cancelPreviewTimer();
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null;
      form.setFieldValue('previewContent', next);
    }, PREVIEW_DEBOUNCE_MS);
  };
  /** Shows a draft (Show in editor, or Replace my edits for a held one): it becomes the working copy. */
  const showDraft = (draft: TemplateDraft) => {
    // Only a draft of this school's template of this type is ever loaded here.
    if (!draftBelongsTo(draft, scope)) return;
    cancelPreviewTimer();
    choose(draft.content);
    form.setFieldValue('editedSinceSend', false);
    form.setFieldValue('previewContent', draft.content);
  };
  /**
   * A message is being sent with what is on screen: the snapshot. The model
   * now drafts from it, so a draft that arrives is shown unless the person
   * changes the template again before it does. A held draft is declined by
   * sending past it (the working copy that was sent is newer than it).
   */
  const markSent = () => {
    if (source.held) choose(source.content);
    form.setFieldValue('editedSinceSend', false);
  };
  /** Keeps a shown draft on screen as the working copy when its chat goes away (New chat). */
  const adoptShown = () => {
    const kept = adoptShownSource(working, source);
    if (kept === working) return;
    form.setFieldValue('content', kept.content);
    form.setFieldValue('manual', kept.edited);
    form.setFieldValue('manualOver', kept.over);
    form.setFieldValue('previewContent', kept.content);
  };
  /** An earlier revision's source and footprint become the working copy; saving it adds a new revision. */
  const restore = (revision: { content: string; pageSize: PageSize }) => {
    cancelPreviewTimer();
    choose(revision.content);
    form.setFieldValue('editedSinceSend', true);
    form.setFieldValue('pageSize', revision.pageSize);
    form.setFieldValue('previewContent', revision.content);
  };
  const reload = async () => {
    if (!(await confirmNavigation())) return;
    cancelPreviewTimer();
    choose(template.content);
    form.setFieldValue('editedSinceSend', true);
    form.setFieldValue('name', template.artifact.name);
    form.setFieldValue('pageSize', template.artifact.pageSize);
    form.setFieldValue('previewContent', template.content);
    form.setFieldValue('error', '');
    await onReload();
  };
  /** Saves what is on screen; `invalid` when the form refused to submit (a name or source to fix), `done` otherwise (saved, or refused by the server into `error`). */
  const save = async (): Promise<'invalid' | 'done'> => {
    // What is on screen is what is saved: a draft shown from the chat becomes the working copy first.
    choose(source.content);
    await form.handleSubmit();
    return form.state.isValid ? 'done' : 'invalid';
  };
  /** The timer is the one outside thing; the root's ref callback clears it when the editor leaves. */
  const rootRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, []);
  return {
    form,
    values,
    source,
    // A draft is shown as soon as it arrives; typing waits for the pause.
    previewSource: source.draft ? source.content : values.previewContent,
    dirty: source.content !== template.content || values.name !== template.artifact.name || values.pageSize !== template.artifact.pageSize,
    editSource,
    showDraft,
    markSent,
    adoptShown,
    restore,
    reload,
    save,
    rootRef,
  };
}

type TemplateEditorState = ReturnType<typeof useTemplateEditor>;

/** How each draft in the chat stands for this editor (`TemplateDraftCard`); a draft of another template is only described. */
function draftBinding(editor: TemplateEditorState, scope: DocumentTemplateScope, savedAt: Date): TemplateDraftBinding {
  return {
    statusOf: (draft): TemplateDraftCardStatus => templateDraftStatusOf(draft, { scope, source: editor.source, savedAt }),
    onShow: editor.showDraft,
  };
}

/**
 * The header's AI action, for someone who may not use the assistant: the
 * portable prompt. Assistant users reach the chat through the AI tab (wide
 * screens) or the bottom bar (`MobileAssistantSheet`), so the header has no
 * button for them; nothing while access is unknown.
 */
function AiAction({
  gate,
  scope,
  editor,
  contextHelp,
}: {
  gate: 'allowed' | 'denied' | 'pending';
  scope: DocumentTemplateScope;
  editor: TemplateEditorState;
  contextHelp?: string;
}) {
  if (gate !== 'denied') return null;
  return <TemplatePromptEditor documentType={scope.documentType} content={editor.source.content} pageSize={editor.values.pageSize} contextHelp={contextHelp} />;
}

/** The template's name and its state (saved, unsaved, a draft from the assistant). */
function TemplateTitle({ title, editor }: { title: string; editor: TemplateEditorState }) {
  const state = editor.source.draft
    ? `Draft ${editor.source.draft.ordinal} from the assistant, not saved`
    : editor.source.held
      ? `Your edits, unsaved · Draft ${editor.source.held.ordinal} is waiting`
      : editor.dirty
        ? 'Unsaved changes'
        : 'Saved';
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
      <p className="truncate text-xs text-muted-foreground" aria-live="polite">
        {state}
      </p>
    </div>
  );
}

/** What the header places: the revision select, the icon actions (All revisions, Marketplace), the AI action, the phone's section select and Save. */
type HeaderParts = { revision: ReactNode; icons: ReactNode; ai: ReactNode; section: ReactNode; save: ReactNode };

/**
 * The header. Wide screens: one row, the name on the left and the actions on
 * the right, Save last. A phone (`compact`) has two rows so the name is never
 * squeezed: the name with the icon actions on its right, then the revision
 * select on the left and the section select and Save on the right.
 */
function WorkspaceHeader({ title, editor, parts, compact }: { title: string; editor: TemplateEditorState; parts: HeaderParts; compact: boolean }) {
  if (compact) {
    return (
      <header className="flex shrink-0 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TemplateTitle title={title} editor={editor} />
          {parts.icons}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {parts.revision}
          <span className="flex-1" />
          {parts.ai}
          {parts.section}
          {parts.save}
        </div>
      </header>
    );
  }
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5">
      <TemplateTitle title={title} editor={editor} />
      <div className="flex flex-wrap items-center gap-2">
        {parts.revision}
        {parts.icons}
        {parts.ai}
        {parts.save}
      </div>
    </header>
  );
}

/**
 * Save: asks for the template's name in a dialog (prefilled with the current
 * one), then stores what is on screen as a new revision. The name is asked
 * only here, so the code pane keeps its room for the code. A name or source
 * the form refuses keeps the dialog open with the errors; a save the server
 * refuses closes it onto the header's error (`SaveError`, which offers the
 * reload). Going back to a saved revision is the revision select's job.
 *
 * For a type printed two-up (admit cards and finance documents) the same
 * dialog confirms the paper footprint: it starts as the editor's when the
 * HTML is the loaded revision's, and unselected when it differs
 * (`initialSaveFootprint`), so a design pasted over another never keeps that
 * design's footprint by accident; Save waits until one is chosen.
 */
function SaveAction({ editor, template }: { editor: TemplateEditorState; template: ActiveTemplate }) {
  const [open, setOpen] = useState(false);
  const choosable = halfPageDocumentTypes.has(template.artifact.documentType);
  const openDialog = () => {
    const footprint = initialSaveFootprint({ choosable, content: editor.source.content, loadedContent: template.content, pageSize: editor.values.pageSize });
    editor.form.setFieldValue('saveFootprint', footprint ?? '');
    setOpen(true);
  };
  const confirm = async () => {
    const footprint = editor.form.getFieldValue('saveFootprint');
    if (choosable) {
      if (!footprint) return;
      editor.form.setFieldValue('pageSize', footprint);
    }
    if ((await editor.save()) === 'done') setOpen(false);
  };
  return (
    <editor.form.Subscribe selector={(state) => state.isSubmitting}>
      {(submitting) => (
        <Dialog open={open} onOpenChange={(next) => setOpen(submitting ? true : next)}>
          <DocumentButton disabled={submitting || !editor.dirty} onClick={openDialog}>
            <Save />
            {submitting ? 'Saving…' : 'Save'}
          </DocumentButton>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Save template</DialogTitle>
              <DialogDescription>Saving adds a new revision, which new documents use.</DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              <editor.form.Field name="name">{(field) => <DocumentField field={field} label="Template name" />}</editor.form.Field>
              {choosable ? (
                <editor.form.Field name="saveFootprint">
                  {(field) => <DocumentSelect field={field} label="Paper footprint" options={SAVE_FOOTPRINT_OPTIONS} />}
                </editor.form.Field>
              ) : null}
              <editor.form.Subscribe selector={(state) => state.errors}>{(errors) => <DocumentErrors errors={errors} />}</editor.form.Subscribe>
              <DialogFooter>
                <DocumentButton variant="outline" disabled={submitting} onClick={() => setOpen(false)}>
                  Cancel
                </DocumentButton>
                <editor.form.Subscribe selector={(state) => state.values.saveFootprint}>
                  {(footprint) => (
                    <DocumentButton type="submit" disabled={submitting || (choosable && !footprint)}>
                      {submitting ? 'Saving…' : 'Save'}
                    </DocumentButton>
                  )}
                </editor.form.Subscribe>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </editor.form.Subscribe>
  );
}

/**
 * The paper footprint, in the code editor's toolbar: no label, the closed
 * select names the size (Half A4, Full A4) and each option says what it
 * means, as the billing dialogs' described selects do.
 */
function FootprintSelect({ value, onChange }: { value: PageSize; onChange: (value: PageSize) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next === 'half' ? 'half' : 'full')}>
      <SelectTrigger size="sm" aria-label="Paper footprint" className="w-28">
        <SelectValue>{PAGE_SIZE_OPTIONS.find((option) => option.value === value)?.title}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {PAGE_SIZE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value} className="min-h-12 py-2">
            <span className="flex flex-col items-start gap-0.5 pr-5">
              <span className="font-semibold">{option.title}</span>
              <span className="text-muted-foreground">{option.description}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A draft that arrived after the person changed the template since sending
 * (`source.held`), under the header: their edits stay on screen, and the
 * draft replaces them only when they say so.
 */
function HeldDraftNotice({ editor }: { editor: TemplateEditorState }) {
  const held = editor.source.held;
  if (!held) return null;
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 text-sm md:border-b md:px-4 md:py-2">
      <p className="min-w-0 flex-1 text-muted-foreground">
        Draft {held.ordinal} arrived while you were editing, so your edits are still in the editor.
      </p>
      <DocumentButton variant="outline" onClick={() => editor.showDraft(held)}>
        <Replace />
        Replace my edits
      </DocumentButton>
    </div>
  );
}

/**
 * A failed save, under the header: the edits stay on screen. Reloading lives
 * here, where it is needed: when someone else saved the template meanwhile,
 * a save is refused until the editor has read the revision now in use
 * (restoring a revision from the select does not re-read it).
 */
function SaveError({ editor }: { editor: TemplateEditorState }) {
  if (!editor.values.error) return null;
  return (
    <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 text-sm md:border-b md:px-4 md:py-2">
      <p className="min-w-0 flex-1 text-destructive">
        {editor.values.error} Your edits are still here. If someone else changed the template, reload the saved one.
      </p>
      <DocumentButton variant="outline" onClick={() => void editor.reload()}>
        <RefreshCw />
        Reload saved
      </DocumentButton>
    </div>
  );
}

/**
 * The code tool: the code editor (with the paper footprint in its toolbar,
 * for the types that have one) and the variable reference. The template's
 * name is asked when saving (`SaveAction`).
 */
function CodePane({ editor, template, contextHelp }: { editor: TemplateEditorState; template: ActiveTemplate; contextHelp?: string }) {
  const { form } = editor;
  const footprint = halfPageDocumentTypes.has(template.artifact.documentType) ? (
    <form.Field name="pageSize">{(field) => <FootprintSelect value={field.state.value} onChange={field.handleChange} />}</form.Field>
  ) : null;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <TemplateCodeEditor value={editor.source.content} onBlur={() => undefined} onChange={editor.editSource} toolbar={footprint} />
      <form.Subscribe selector={(state) => state.errors}>{(errors) => <DocumentErrors errors={errors} />}</form.Subscribe>
      <details className="shrink-0 border-t px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Template variable reference</summary>
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
          {contextHelp ?? 'Loading variable reference…'}
        </pre>
      </details>
    </div>
  );
}

/** The marketplace, as an icon button named by its tooltip. */
function MarketplaceLink({ href }: { href: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DocumentButton asChild size="icon" variant="outline">
          <Link href={href} aria-label="Marketplace">
            <Store />
          </Link>
        </DocumentButton>
      </TooltipTrigger>
      <TooltipContent>Marketplace</TooltipContent>
    </Tooltip>
  );
}

/** An icon button named by its tooltip. */
function IconAction({ label, icon, onClick, disabled }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DocumentButton size="icon-sm" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick}>
          {icon}
        </DocumentButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The left pane: the assistant and the code as two tabs (the code alone for
 * someone without the assistant). Both stay mounted while the other is
 * shown, so a half-typed message, a streaming reply and the code editor's
 * cursor survive switching. On a phone the section switch above it chooses
 * the tool, so the pane has no header there (`header` false).
 */
function EditPane({
  tool,
  onTool,
  assistant,
  code,
  header,
  aiActions,
  onCollapse,
}: {
  tool: EditTool;
  onTool: (tool: EditTool) => void;
  /** The chat; null when the user may not use the assistant. */
  assistant: ReactNode | null;
  code: ReactNode;
  header: boolean;
  /** Shown in the header while the chat is the tool on screen (New chat). */
  aiActions: ReactNode;
  /** Folds the pane away (wide screens only). */
  onCollapse?: () => void;
}) {
  const shown = assistant ? tool : 'code';
  return (
    <Tabs value={shown} onValueChange={(value) => onTool(value as EditTool)} className="flex h-full min-h-0 flex-col gap-0 bg-background">
      {header ? (
        <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
          {assistant ? (
            <TabsList variant="line" aria-label="Edit with">
              <TabsTrigger value="ai">AI</TabsTrigger>
              <TabsTrigger value="code">Code</TabsTrigger>
            </TabsList>
          ) : (
            <span className="flex items-center gap-2 text-sm font-medium">
              <Code2 className="size-4 text-muted-foreground" aria-hidden /> Code
            </span>
          )}
          <span className="flex-1" />
          {shown === 'ai' ? aiActions : null}
          {onCollapse ? <IconAction label="Hide editor" icon={<PanelLeftClose />} onClick={onCollapse} /> : null}
        </div>
      ) : null}
      {assistant ? (
        <TabsContent value="ai" forceMount className="min-h-0 flex-1 data-[state=inactive]:hidden">
          {assistant}
        </TabsContent>
      ) : null}
      <TabsContent value="code" forceMount className="min-h-0 flex-1 data-[state=inactive]:hidden">
        {code}
      </TabsContent>
    </Tabs>
  );
}

/** The preview's strip: what it shows, the notice print size and refresh. */
function PreviewToolbar({
  scope,
  editor,
  showingRevision,
}: {
  scope: DocumentTemplateScope;
  editor: TemplateEditorState;
  /** An earlier revision is on screen, not the working copy. */
  showingRevision: boolean;
}) {
  const waiting = !showingRevision && editor.previewSource !== editor.source.content;
  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-1.5">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-xs font-medium">Preview</span>
      <span className="flex-1 text-xs text-muted-foreground" aria-live="polite">
        {waiting ? 'Waiting for you to stop typing…' : 'Your school’s data, samples where missing'}
      </span>
      {scope.documentType === 'notice' ? (
        <editor.form.Field name="printSize">
          {(field) => (
            <OptionSelect
              value={field.state.value}
              options={noticePrintSizeOptions}
              onValueChange={field.handleChange}
              triggerProps={{ 'aria-label': 'Preview as', className: 'w-56 max-sm:w-full' }}
            />
          )}
        </editor.form.Field>
      ) : null}
      {waiting ? (
        <IconAction label="Refresh preview now" icon={<RefreshCw />} onClick={() => editor.form.setFieldValue('previewContent', editor.source.content)} />
      ) : null}
    </div>
  );
}

/**
 * The template as it prints, with the school's data (samples where missing
 * or not readable), as PDF pages: the working
 * copy, or an earlier revision read-only (`revision`, which brings its own
 * notice and preview).
 */
function PreviewPane({
  scope,
  editor,
  title,
  revision,
}: {
  scope: DocumentTemplateScope;
  editor: TemplateEditorState;
  title: string;
  revision: ReactNode | null;
}) {
  return (
    <section aria-label="Template preview" className="flex h-full min-h-0 min-w-0 flex-col md:bg-muted/30">
      <PreviewToolbar scope={scope} editor={editor} showingRevision={revision !== null} />
      <div className="min-h-0 flex-1 p-2 md:p-4">
        {revision ?? (
          <TemplatePdfPreview
            scope={scope}
            content={editor.previewSource}
            pageSize={editor.values.pageSize}
            printSize={editor.values.printSize}
            label={`${title} preview`}
          />
        )}
      </div>
    </section>
  );
}

const MOBILE_SECTIONS: { value: MobileSection; label: string }[] = [
  { value: 'preview', label: 'Preview' },
  { value: 'code', label: 'Code' },
];

/**
 * The phone's section select in the header: the preview or the code. A
 * select rather than a switch, so the code is offered only to someone who
 * opens it; the assistant opens from the bottom bar (`MobileAssistantSheet`).
 */
function MobileSectionSelect({ value, onChange }: { value: MobileSection; onChange: (value: MobileSection) => void }) {
  return (
    <OptionSelect
      value={value}
      options={MOBILE_SECTIONS}
      onValueChange={(next) => onChange(next === 'code' ? 'code' : 'preview')}
      triggerProps={{ 'aria-label': 'Show', className: 'w-24' }}
    />
  );
}

/**
 * The folded editing pane on wide screens, as the question paper studio's
 * assistant rail: a strip the height of the workspace that opens the pane
 * again, so folding it (with *Hide editor* or by dragging the split all the
 * way) never leaves the editor without a visible way back. A dot marks an
 * assistant draft that is not saved yet.
 */
function EditRail({ withAssistant, draftOrdinal, onOpen }: { withAssistant: boolean; draftOrdinal: number | null; onOpen: () => void }) {
  const name = withAssistant ? 'assistant and code' : 'code';
  const label = draftOrdinal === null ? `Show ${name}` : `Show ${name} (Draft ${draftOrdinal} is not saved yet)`;
  const Icon = withAssistant ? Sparkles : Code2;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-expanded={false}
          onClick={onOpen}
          className="group flex w-11 shrink-0 flex-col items-center gap-3 border-r bg-background py-3 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <PanelLeftOpen className="size-4" aria-hidden />
          <span className="relative">
            <Icon className="size-4 text-primary transition-transform group-hover:scale-110" aria-hidden />
            {draftOrdinal === null ? null : <span className="absolute -end-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-background" aria-hidden />}
          </span>
          <span className="rotate-180 text-xs font-medium tracking-wide [writing-mode:vertical-rl]">{withAssistant ? 'Ask the assistant' : 'Show code'}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Side by side from md up: the editing pane on the left (resizable, and
 * foldable so the preview takes the width), the preview on the right. A
 * folded pane leaves its rail (`EditRail`) at the left edge.
 */
function DesktopPanes({
  panelRef,
  edit,
  preview,
  rail,
}: {
  panelRef: PanelRef;
  edit: (onCollapse: () => void) => ReactNode;
  preview: ReactNode;
  rail: (onOpen: () => void) => ReactNode;
}) {
  const [editOpen, setEditOpen] = useState(true);
  return (
    <div className="flex min-h-0 flex-1">
      {editOpen ? null : rail(() => panelRef.current?.expand())}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1">
        <ResizablePanel defaultSize="40" minSize="28" collapsible collapsedSize="0" panelRef={panelRef} onResize={(size) => setEditOpen(size.asPercentage > 0)}>
          {edit(() => panelRef.current?.collapse())}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="60" minSize="30">
          {preview}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/**
 * The assistant on a phone, as in the question paper studio: a bar fixed to
 * the bottom of the screen ("Ask for a change") opens the chat over the whole
 * screen, with its own header (New chat, Close). The chat stays mounted while
 * the sheet is closed, so a half-typed message and a streaming reply survive.
 */
function MobileAssistantSheet({
  open,
  onOpenChange,
  actions,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chat's own actions in the sheet's header (New chat). */
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <aside aria-label="Assistant for this template" className={cn('flex-col bg-background', open ? 'fixed inset-0 z-40 flex' : 'hidden')}>
        <header className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h3 className="ms-1 min-w-0 flex-1 truncate text-sm font-medium">Assistant</h3>
          {actions}
          <IconAction label="Close assistant" icon={<X />} onClick={() => onOpenChange(false)} />
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </aside>
      {open ? null : (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background p-3">
          <DocumentButton className="w-full" onClick={() => onOpenChange(true)}>
            <Sparkles />
            Ask for a change
          </DocumentButton>
        </div>
      )}
    </>
  );
}

/** One section at a time on a phone; both stay mounted, so switching loses nothing. */
function MobilePanes({ previewShown, edit, preview }: { previewShown: boolean; edit: ReactNode; preview: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className={cn('h-[75dvh] overflow-hidden rounded-xl border', previewShown && 'hidden')}>{edit}</div>
      <div className={cn('h-[75dvh] overflow-hidden rounded-xl border', !previewShown && 'hidden')}>{preview}</div>
    </div>
  );
}

/**
 * What the builder shows: the editing tool (AI or Code) and, on a phone,
 * whether the preview is the section on screen and whether the assistant's
 * sheet is open. Kept by the page above the editor (`EditableTemplate`), so a
 * save, which remounts the editor on the new revision, does not send the
 * person back to the defaults.
 */
export function useTemplateWorkspaceView() {
  const [tool, setTool] = useState<EditTool>('ai');
  // A phone shows the preview first, as the question paper studio shows the paper.
  const [mobilePreview, setMobilePreview] = useState(true);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  return { tool, setTool, mobilePreview, setMobilePreview, mobileChatOpen, setMobileChatOpen };
}
export type TemplateWorkspaceView = ReturnType<typeof useTemplateWorkspaceView>;

/**
 * The template builder, laid out like the question paper studio: one header
 * row, then the editing pane beside the template as it prints. The editing
 * pane holds the assistant ("AI", for those who may use it) and the code
 * ("Code", the source and its settings); the preview is the PDF the template
 * prints as, with the school's data where available. From md up it fills the window under the app's
 * header and the two panes scroll inside themselves; on a phone it is an
 * ordinary page with one section at a time.
 *
 * The assistant proposes whole templates in its chat; the newest one is shown
 * in the code and the preview at once (unsaved), and Save stores
 * what is on screen as a new revision, exactly as a hand edit would be.
 */
export function TemplateEditor({
  scope,
  template,
  title,
  contextHelp,
  marketplaceHref,
  view,
  onReload,
}: {
  scope: DocumentTemplateScope;
  template: ActiveTemplate;
  title: string;
  contextHelp?: string;
  marketplaceHref: string;
  view: TemplateWorkspaceView;
  onReload: () => Promise<void>;
}) {
  const gate = useAssistantGate(scope.schoolId);
  const savedAt = new Date(template.artifact.createdAt);
  const chat = useTemplateChat(scope, savedAt, gate === 'allowed');
  const editor = useTemplateEditor(scope, template, chat.latest, onReload);
  const sideBySide = useSideBySide();
  const editPanelRef = useResizablePanelRef();
  const { tool, setTool, mobilePreview, setMobilePreview, mobileChatOpen, setMobileChatOpen } = view;
  const withAssistant = gate === 'allowed';
  const shownTool: EditTool = withAssistant ? tool : 'code';
  const revisions = useRevisionView(scope, editor, template.revisionId, setMobilePreview);
  const sourceForChat = (): AssistantEditorSource | null => {
    // Read at the moment of sending: what is on screen now is what the model will draft from.
    editor.markSent();
    const content = sourceToSend({ current: editor.source.content, lastKnown: lastKnownSourceOf(chat.rows, scope.documentType) });
    return content ? { documentType: scope.documentType, content } : null;
  };
  /** New chat: a draft shown from the old chat stays on screen as unsaved work instead of vanishing with it. */
  const startNewChat = () => {
    editor.adoptShown();
    chat.startNew();
  };
  const chatWithDrafts = { ...chat, startNew: startNewChat };
  const drafts = draftBinding(editor, scope, savedAt);
  /** On a phone, showing a draft closes the sheet on the preview, where the draft now is. */
  const phoneDrafts: TemplateDraftBinding = {
    ...drafts,
    onShow: (draft) => {
      drafts.onShow(draft);
      setMobileChatOpen(false);
      setMobilePreview(true);
    },
  };
  const assistant = withAssistant ? (
    <TemplateAssistantPane scope={scope} chat={chatWithDrafts} sourceToSend={sourceForChat} drafts={sideBySide ? drafts : phoneDrafts} />
  ) : null;
  const aiActions = chat.chatId ? <NewTemplateChatButton onClick={startNewChat} /> : null;
  const code = <CodePane editor={editor} template={template} contextHelp={contextHelp} />;
  // On a phone the chat lives in its own sheet, so the editing pane holds the code alone.
  const edit = (onCollapse?: () => void) => (
    <EditPane tool={shownTool} onTool={setTool} assistant={sideBySide ? assistant : null} code={code} header={sideBySide} aiActions={aiActions} onCollapse={onCollapse} />
  );
  const preview = <PreviewPane scope={scope} editor={editor} title={title} revision={revisions.view} />;
  const rail = (onOpen: () => void) => <EditRail withAssistant={withAssistant} draftOrdinal={editor.source.draft?.ordinal ?? null} onOpen={onOpen} />;
  return (
    // md+: cancels the shell's page padding and takes the window's remaining height, as the question paper studio does.
    // A phone with the assistant keeps room at the bottom for the fixed "Ask for a change" bar.
    <div
      ref={editor.rootRef}
      className={cn('flex min-w-0 flex-col gap-4 md:-m-6 md:gap-0 lg:-m-8', APP_SHELL_FILL_HEIGHT_MD_CLASS, withAssistant && !sideBySide && 'pb-16')}
    >
      <DocumentDirtyGuard dirty={editor.dirty} />
      <WorkspaceHeader
        title={title}
        editor={editor}
        compact={!sideBySide}
        parts={{
          revision: revisions.picker,
          icons: (
            <>
              {revisions.historyButton}
              <MarketplaceLink href={marketplaceHref} />
            </>
          ),
          ai: <AiAction gate={gate} scope={scope} editor={editor} contextHelp={contextHelp} />,
          section: sideBySide ? null : <MobileSectionSelect value={mobilePreview ? 'preview' : 'code'} onChange={(section) => setMobilePreview(section === 'preview')} />,
          save: <SaveAction editor={editor} template={template} />,
        }}
      />
      <SaveError editor={editor} />
      <HeldDraftNotice editor={editor} />
      {revisions.dialogs}
      {sideBySide ? (
        <DesktopPanes panelRef={editPanelRef} edit={edit} preview={preview} rail={rail} />
      ) : (
        <>
          <MobilePanes previewShown={mobilePreview} edit={edit()} preview={preview} />
          {assistant ? (
            <MobileAssistantSheet open={mobileChatOpen} onOpenChange={setMobileChatOpen} actions={aiActions}>
              {assistant}
            </MobileAssistantSheet>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The builder's revision history (docs/document-system.md, "Revision
 * history"): the revision in the address, its read-only view for the
 * preview pane, the header's picker, the history dialog and the Restore
 * confirmation. Restoring replaces unsaved changes only after the app's own
 * dialog.
 */
function useRevisionView(scope: DocumentTemplateScope, editor: TemplateEditorState, baseRevisionId: string, setMobilePreview: (shown: boolean) => void) {
  const { revisionId, setRevision } = useRevisionParam();
  const revision = useTemplateRevision(scope, revisionId);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** An earlier revision waiting for the person to confirm that it replaces their unsaved changes. */
  const [restoring, setRestoring] = useState<{ content: string; pageSize: PageSize } | null>(null);
  const restoreNow = (next: { content: string; pageSize: PageSize }) => {
    editor.restore(next);
    setRestoring(null);
    setRevision(null);
  };
  const viewRevision = (next: string | null) => {
    setRevision(next);
    // On a phone the revision is in the preview.
    if (next) setMobilePreview(true);
  };
  const view = revisionId ? (
    <RevisionPreview
      scope={scope}
      revisionId={revisionId}
      revision={revision}
      printSize={editor.values.printSize}
      // Nothing is lost silently: unsaved changes are replaced only after the app's own dialog.
      onRestore={(next) => (editor.dirty ? setRestoring(next) : restoreNow(next))}
      onClose={() => setRevision(null)}
    />
  ) : null;
  const picker = (
    <RevisionPicker
      scope={scope}
      revisionId={revisionId}
      baseRevisionId={baseRevisionId}
      shown={revision.data?.revision}
      failed={revision.isError}
      dirty={editor.dirty}
      onChange={viewRevision}
    />
  );
  const historyButton = <AllRevisionsButton onClick={() => setHistoryOpen(true)} />;
  const dialogs = (
    <>
      <RevisionHistoryDialog scope={scope} open={historyOpen} onOpenChange={setHistoryOpen} shownRevisionId={revisionId} onView={viewRevision} />
      <ConfirmationDialog
        open={restoring !== null}
        title="Replace your unsaved changes?"
        description="Restoring this revision replaces the template in the editor, including changes you have not saved. Nothing is saved until you press Save."
        confirmLabel="Restore"
        confirmVariant="default"
        onOpenChange={(open) => {
          if (!open) setRestoring(null);
        }}
        onConfirm={() => {
          if (restoring) restoreNow(restoring);
        }}
      />
    </>
  );
  return { view, picker, historyButton, dialogs };
}
