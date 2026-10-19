'use client';

import Editor, { type OnMount } from '@monaco-editor/react';
import { Braces, PanelLeftClose, WandSparkles } from 'lucide-react';
import { useRef } from 'react';
import { DocumentButton } from '@campuspilot/components/documents/document-controls';
import { useTheme } from '@campuspilot/ui/lib/theme';

type MonacoEditor = Parameters<OnMount>[0];

/**
 * Keeps Monaco behind a small client-only boundary so the settings route does
 * not load the editor runtime until a school already has an editable template.
 * HTML mode provides Monaco's formatter while still highlighting Handlebars
 * expressions embedded in the document as template text.
 */
export function TemplateCodeEditor({
  value,
  onChange,
  onBlur,
  onCollapse,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onCollapse: () => void;
}) {
  const editorRef = useRef<MonacoEditor | null>(null);
  const { resolvedTheme } = useTheme();

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-card">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Braces className="size-3.5 shrink-0" aria-hidden />
          Handlebars HTML
        </span>
        <div className="flex items-center gap-1">
          <DocumentButton
            variant="ghost"
            size="sm"
            onClick={() => {
              void editorRef.current
                ?.getAction('editor.action.formatDocument')
                ?.run();
            }}
          >
            <WandSparkles />
            Format
          </DocumentButton>
          <DocumentButton
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse code editor"
            title="Collapse code editor"
            onClick={onCollapse}
          >
            <PanelLeftClose />
          </DocumentButton>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language="html"
          path="school-template.handlebars.html"
          value={value}
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
          onMount={(editor) => {
            editorRef.current = editor;
            editor.onDidBlurEditorText(onBlur);
          }}
          onChange={(nextValue) => onChange(nextValue ?? '')}
          loading={
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Loading code editor…
            </div>
          }
          options={{
            automaticLayout: true,
            bracketPairColorization: { enabled: true },
            fontSize: 13,
            formatOnPaste: true,
            formatOnType: true,
            lineNumbers: 'on',
            minimap: { enabled: false },
            padding: { top: 12, bottom: 12 },
            scrollBeyondLastLine: false,
            tabSize: 2,
            wordWrap: 'on',
          }}
        />
      </div>
    </section>
  );
}
