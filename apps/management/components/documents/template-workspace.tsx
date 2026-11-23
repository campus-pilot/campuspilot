'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { Code2, FileText, PanelLeftClose, PanelLeftOpen, RefreshCw, Replace, Save, Sparkles, Store } from 'lucide-react';
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
import { ToggleGroup, ToggleGroupItem } from '@campuspilot/ui/components/toggle-group';
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
import { RevisionHistoryDialog, RevisionPicker, RevisionPreview, useRevisionParam, useTemplateRevision } from './template-revisions';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';


const TemplateCodeEditor = dynamic(() => import('./template-code-editor').then((module) => module.TemplateCodeEditor), {
  ssr: false,
  loading: () => <div className="grid h-full min-h-96 place-items-center bg-card text-sm text-muted-foreground">Loading code editor…</div>,
});

type PageSize = 'full' | 'half';
/** The left pane's two tools: the assistant's chat and the code with its settings. */
type EditTool = 'ai' | 'code';
/** What a phone shows: one section at a time, as on the question paper studio. */
type MobileSection = 'preview' | EditTool;
type PanelRef = ReturnType<typeof useResizablePanelRef>;

const halfPageDocumentTypes = new Set<DocumentTemplateScope['documentType']>(HALF_PAGE_DOCUMENT_TYPES);
const pageSizeOptions = [
  { value: 'half', label: 'Half A4 · two per sheet' },
  { value: 'full', label: 'Full A4 · one per sheet' },
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
  const save = () => {
    // What is on screen is what is saved: a draft shown from the chat becomes the working copy first.
    choose(source.content);
    void form.handleSubmit();
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

/** The header's AI action: the assistant for those who may use it, else the portable prompt; nothing while unknown. */
function AiAction({
  gate,
  scope,
  editor,
  contextHelp,
  onAsk,
}: {
  gate: 'allowed' | 'denied' | 'pending';
  scope: DocumentTemplateScope;
  editor: TemplateEditorState;
  contextHelp?: string;
  onAsk: () => void;
}) {
  if (gate === 'pending') return null;
  if (gate === 'allowed') {
    return (
      <DocumentButton variant="outline" onClick={onAsk}>
        <Sparkles />
        Ask for edit
      </DocumentButton>
    );
  }
  return <TemplatePromptEditor documentType={scope.documentType} content={editor.source.content} pageSize={editor.values.pageSize} contextHelp={contextHelp} />;
}

/** The one header row: the template's name and state, then its actions (the main one, Save, last). */
function WorkspaceHeader({ title, editor, actions }: { title: string; editor: TemplateEditorState; actions: ReactNode }) {
  const state = editor.source.draft
    ? `Draft ${editor.source.draft.ordinal} from the assistant, not saved`
    : editor.source.held
      ? `Your edits, unsaved · Draft ${editor.source.held.ordinal} is waiting`
      : editor.dirty
        ? 'Unsaved changes'
        : 'Saved';
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 md:border-b md:px-4 md:py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
        <p className="truncate text-xs text-muted-foreground" aria-live="polite">
          {state}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

function SaveActions({ editor }: { editor: TemplateEditorState }) {
  return (
    <editor.form.Subscribe selector={(state) => ({ submitting: state.isSubmitting, canSubmit: state.canSubmit })}>
      {({ submitting, canSubmit }) => (
        <>
          <DocumentButton variant="ghost" disabled={submitting} onClick={() => void editor.reload()}>
            Reload saved
          </DocumentButton>
          <DocumentButton disabled={submitting || !canSubmit || !editor.dirty} onClick={editor.save}>
            <Save />
            {submitting ? 'Saving…' : 'Save template'}
          </DocumentButton>
        </>
      )}
    </editor.form.Subscribe>
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

/** A failed save, under the header: the edits stay on screen. */
function SaveError({ editor }: { editor: TemplateEditorState }) {
  if (!editor.values.error) return null;
  return (
    <p role="alert" className="shrink-0 text-sm text-destructive md:border-b md:px-4 md:py-2">
      {editor.values.error} Your edits are still here. Reload the saved revision if someone else changed the template.
    </p>
  );
}

/** The code tool: the template's name and footprint, the code editor, and the variable reference. */
function CodePane({ editor, template, contextHelp }: { editor: TemplateEditorState; template: ActiveTemplate; contextHelp?: string }) {
  const { form } = editor;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="grid shrink-0 gap-3 border-b p-3 sm:grid-cols-2">
        <form.Field name="name">{(field) => <DocumentField field={field} label="Template name" />}</form.Field>
        {halfPageDocumentTypes.has(template.artifact.documentType) ? (
          <form.Field name="pageSize">{(field) => <DocumentSelect field={field} label="Paper footprint" options={pageSizeOptions} />}</form.Field>
        ) : null}
      </div>
      <TemplateCodeEditor value={editor.source.content} onBlur={() => undefined} onChange={editor.editSource} />
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

/** The preview's strip: what it shows, the notice print size, refresh, and the way back to a folded editor. */
function PreviewToolbar({
  scope,
  editor,
  showingRevision,
  onExpand,
}: {
  scope: DocumentTemplateScope;
  editor: TemplateEditorState;
  /** An earlier revision is on screen, not the working copy. */
  showingRevision: boolean;
  /** Shows the folded editor again; absent while it is shown. */
  onExpand?: () => void;
}) {
  const waiting = !showingRevision && editor.previewSource !== editor.source.content;
  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-1.5">
      {onExpand ? <IconAction label="Show editor" icon={<PanelLeftOpen />} onClick={onExpand} /> : null}
      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-xs font-medium">Preview</span>
      <span className="flex-1 text-xs text-muted-foreground" aria-live="polite">
        {waiting ? 'Waiting for you to stop typing…' : 'Sample data'}
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
 * The template as it prints, with sample data, as PDF pages: the working
 * copy, or an earlier revision read-only (`revision`, which brings its own
 * notice and preview).
 */
function PreviewPane({
  scope,
  editor,
  title,
  revision,
  onExpand,
}: {
  scope: DocumentTemplateScope;
  editor: TemplateEditorState;
  title: string;
  revision: ReactNode | null;
  onExpand?: () => void;
}) {
  return (
    <section aria-label="Template preview" className="flex h-full min-h-0 min-w-0 flex-col md:bg-muted/30">
      <PreviewToolbar scope={scope} editor={editor} showingRevision={revision !== null} onExpand={onExpand} />
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

/** The phone's section switch: the preview, or one of the editing tools. */
function MobileSwitch({ value, withAssistant, onChange }: { value: MobileSection; withAssistant: boolean; onChange: (value: MobileSection) => void }) {
  const options: { value: MobileSection; label: string }[] = [
    { value: 'preview', label: 'Preview' },
    ...(withAssistant ? [{ value: 'ai' as const, label: 'AI' }] : []),
    { value: 'code', label: 'Code' },
  ];
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      aria-label="Show"
      className="min-w-0 flex-1"
      value={value}
      onValueChange={(next) => {
        // Pressing the chosen section again keeps it chosen.
        const chosen = options.find((option) => option.value === next);
        if (chosen) onChange(chosen.value);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * Side by side from md up: the editing pane on the left (resizable, and
 * foldable so the preview takes the width), the preview on the right.
 */
function DesktopPanes({
  panelRef,
  edit,
  preview,
}: {
  panelRef: PanelRef;
  edit: (onCollapse: () => void) => ReactNode;
  preview: (onExpand?: () => void) => ReactNode;
}) {
  const [editOpen, setEditOpen] = useState(true);
  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel defaultSize="40" minSize="28" collapsible collapsedSize="0" panelRef={panelRef} onResize={(size) => setEditOpen(size.asPercentage > 0)}>
        {edit(() => panelRef.current?.collapse())}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="60" minSize="30">
        {preview(editOpen ? undefined : () => panelRef.current?.expand())}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/** The phone's section switch, with the chat's own action (New chat) beside it while the chat is the section shown. */
function MobileSwitchRow({ switcher, aiActions }: { switcher: ReactNode; aiActions: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {switcher}
      {aiActions}
    </div>
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
 * whether the preview is the section on screen. Kept by the page above the
 * editor (`EditableTemplate`), so a save, which remounts the editor on the
 * new revision, does not send the person back to the defaults.
 */
export function useTemplateWorkspaceView() {
  const [tool, setTool] = useState<EditTool>('ai');
  // A phone shows the preview first, as the question paper studio shows the paper.
  const [mobilePreview, setMobilePreview] = useState(true);
  return { tool, setTool, mobilePreview, setMobilePreview };
}
export type TemplateWorkspaceView = ReturnType<typeof useTemplateWorkspaceView>;

/**
 * The template builder, laid out like the question paper studio: one header
 * row, then the editing pane beside the template as it prints. The editing
 * pane holds the assistant ("AI", for those who may use it) and the code
 * ("Code", the source and its settings); the preview is the PDF the template
 * prints as, with sample data. From md up it fills the window under the app's
 * header and the two panes scroll inside themselves; on a phone it is an
 * ordinary page with one section at a time.
 *
 * The assistant proposes whole templates in its chat; the newest one is shown
 * in the code and the preview at once (unsaved), and Save template stores
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
  const { tool, setTool, mobilePreview, setMobilePreview } = view;
  const withAssistant = gate === 'allowed';
  const shownTool: EditTool = withAssistant ? tool : 'code';
  const revisions = useRevisionView(scope, editor, setMobilePreview);
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
  const assistant = withAssistant ? (
    <TemplateAssistantPane scope={scope} chat={chatWithDrafts} sourceToSend={sourceForChat} drafts={draftBinding(editor, scope, savedAt)} />
  ) : null;
  const aiActions = chat.chatId ? <NewTemplateChatButton onClick={startNewChat} /> : null;
  const code = <CodePane editor={editor} template={template} contextHelp={contextHelp} />;
  /** "Ask for edit": the chat on screen, with the editing pane unfolded if it was folded away. */
  const ask = () => {
    setTool('ai');
    setMobilePreview(false);
    editPanelRef.current?.expand();
  };
  const edit = (onCollapse?: () => void) => (
    <EditPane tool={shownTool} onTool={setTool} assistant={assistant} code={code} header={sideBySide} aiActions={aiActions} onCollapse={onCollapse} />
  );
  const preview = (onExpand?: () => void) => <PreviewPane scope={scope} editor={editor} title={title} revision={revisions.view} onExpand={onExpand} />;
  return (
    // md+: cancels the shell's page padding and takes the window's remaining height, as the question paper studio does.
    <div ref={editor.rootRef} className={cn('flex min-w-0 flex-col gap-4 md:-m-6 md:gap-0 lg:-m-8', APP_SHELL_FILL_HEIGHT_MD_CLASS)}>
      <DocumentDirtyGuard dirty={editor.dirty} />
      <WorkspaceHeader
        title={title}
        editor={editor}
        actions={
          <>
            {revisions.picker}
            <AiAction gate={gate} scope={scope} editor={editor} contextHelp={contextHelp} onAsk={ask} />
            <DocumentButton asChild variant="outline">
              <Link href={marketplaceHref}>
                <Store />
                Marketplace
              </Link>
            </DocumentButton>
            <SaveActions editor={editor} />
          </>
        }
      />
      <SaveError editor={editor} />
      <HeldDraftNotice editor={editor} />
      {revisions.dialogs}
      {sideBySide ? (
        <DesktopPanes panelRef={editPanelRef} edit={edit} preview={preview} />
      ) : (
        <>
          <MobileSwitchRow
            switcher={
              <MobileSwitch
                value={mobilePreview ? 'preview' : shownTool}
                withAssistant={withAssistant}
                onChange={(section) => {
                  setMobilePreview(section === 'preview');
                  if (section !== 'preview') setTool(section);
                }}
              />
            }
            aiActions={!mobilePreview && shownTool === 'ai' ? aiActions : null}
          />
          <MobilePanes previewShown={mobilePreview} edit={edit()} preview={preview()} />
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
function useRevisionView(scope: DocumentTemplateScope, editor: TemplateEditorState, setMobilePreview: (shown: boolean) => void) {
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
      shown={revision.data?.revision}
      failed={revision.isError}
      dirty={editor.dirty}
      onChange={viewRevision}
      onOpenHistory={() => setHistoryOpen(true)}
    />
  );
  const dialogs = (
    <>
      <RevisionHistoryDialog scope={scope} open={historyOpen} onOpenChange={setHistoryOpen} shownRevisionId={revisionId} onView={viewRevision} />
      <ConfirmationDialog
        open={restoring !== null}
        title="Replace your unsaved changes?"
        description="Restoring this revision replaces the template in the editor, including changes you have not saved. Nothing is saved until you press Save template."
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
  return { view, picker, dialogs };
}
