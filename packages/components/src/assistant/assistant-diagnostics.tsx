import type { AssistantRunDiagnosticsDto } from '@campuspilot/assistant-contract/dto';
import { formatUsdText, sumUsd } from '@campuspilot/assistant-contract/money';
import { Popover, PopoverContent, PopoverTrigger } from '@campuspilot/ui/components/popover';
import { cn } from '@campuspilot/ui/lib/utils';
import { Gauge } from 'lucide-react';
import type { ReactNode } from 'react';

import { AssistantCopyButton } from './assistant-copy-button';

/**
 * Developer diagnostics: what each turn cost and why it failed. They render
 * only when the service sends diagnostics (ASSISTANT_DIAGNOSTICS), so real
 * users never see them. The dashed outline marks them as a developer
 * overlay rather than part of the product.
 */

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat('en');

const formatTokens = (count: number) => compact.format(count);

const totalTokens = (usage: AssistantRunDiagnosticsDto) =>
  usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;

/** Totals over a conversation's runs. */
export type AssistantUsageTotals = {
  runs: number;
  modelRequestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** Exact sum of the runs' saved costs, in USD (decimal text). */
  costUsd: string;
};

export function sumAssistantUsage(list: readonly AssistantRunDiagnosticsDto[]): AssistantUsageTotals {
  return list.reduce<AssistantUsageTotals>(
    (sum, run) => ({
      runs: sum.runs + 1,
      modelRequestCount: sum.modelRequestCount + run.modelRequestCount,
      inputTokens: sum.inputTokens + run.inputTokens,
      outputTokens: sum.outputTokens + run.outputTokens,
      cacheReadInputTokens: sum.cacheReadInputTokens + run.cacheReadInputTokens,
      cacheCreationInputTokens: sum.cacheCreationInputTokens + run.cacheCreationInputTokens,
      costUsd: sumUsd([sum.costUsd, run.costUsd]),
    }),
    {
      runs: 0,
      modelRequestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: '0',
    },
  );
}

/** The dashed chip that opens a diagnostics popover. */
function DiagnosticsChip({ label, summary, children }: { label: string; summary: ReactNode; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className="inline-flex h-[22px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-1.5 font-mono text-[11px] text-assistant-dim tabular-nums transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:text-foreground"
      >
        <Gauge className="size-3 shrink-0" aria-hidden />
        {summary}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function DiagnosticsHeader({ title, copyText }: { title: string; copyText: string }) {
  return (
    <header className="flex items-center gap-2">
      <h3 className="flex-1 text-[13px] font-medium text-foreground">{title}</h3>
      <span className="text-[11px] text-assistant-dim">Developer only</span>
      <AssistantCopyButton text={copyText} label="Copy as JSON" />
    </header>
  );
}

type Row = readonly [label: string, value: ReactNode, mono?: boolean];

function DiagnosticsList({ rows }: { rows: readonly Row[] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
      {rows.map(([label, value, mono]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={cn('min-w-0 text-end break-all text-foreground tabular-nums', mono && 'font-mono text-[11px]')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const tokenRows = (usage: Omit<AssistantRunDiagnosticsDto, 'provider' | 'model' | 'costUsd' | 'errorDetail'>): Row[] => [
  ['Model calls', exact.format(usage.modelRequestCount)],
  ['Input', exact.format(usage.inputTokens)],
  ['Cached input', exact.format(usage.cacheReadInputTokens)],
  ['Cache writes', exact.format(usage.cacheCreationInputTokens)],
  ['Output', exact.format(usage.outputTokens)],
];

/** One turn's diagnostics, on the right of its work bar. */
export function AssistantRunDiagnostics({ runId, diagnostics }: { runId: string; diagnostics: AssistantRunDiagnosticsDto }) {
  return (
    <DiagnosticsChip
      label="Turn diagnostics"
      summary={
        <>
          <span>{formatTokens(totalTokens(diagnostics))}</span>
          <span>{formatUsdText(diagnostics.costUsd)}</span>
        </>
      }
    >
      <DiagnosticsHeader title="This turn" copyText={JSON.stringify({ runId, ...diagnostics }, null, 2)} />
      <DiagnosticsList
        rows={[
          ['Run', runId, true],
          ['Provider', diagnostics.provider ?? 'Not started'],
          ['Model', diagnostics.model ?? 'Not started', true],
          ...tokenRows(diagnostics),
          ['Cost', formatUsdText(diagnostics.costUsd)],
        ]}
      />
      {diagnostics.errorDetail ? (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs text-destructive">Error detail</h4>
          <pre className="max-h-48 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px]/4 whitespace-pre-wrap break-all text-foreground dark:bg-muted/40">
            {diagnostics.errorDetail}
          </pre>
        </section>
      ) : null}
    </DiagnosticsChip>
  );
}

/** The conversation's totals, for the composer's toolbar. */
export function AssistantConversationUsage({ totals }: { totals: AssistantUsageTotals }) {
  const tokens = totals.inputTokens + totals.outputTokens + totals.cacheReadInputTokens + totals.cacheCreationInputTokens;
  return (
    <DiagnosticsChip
      label="Conversation diagnostics"
      summary={
        <>
          <span>{formatTokens(tokens)}</span>
          <span>{formatUsdText(totals.costUsd)}</span>
        </>
      }
    >
      <DiagnosticsHeader title="This conversation" copyText={JSON.stringify(totals, null, 2)} />
      <DiagnosticsList
        rows={[
          ['Turns', exact.format(totals.runs)],
          ...tokenRows(totals),
          ['Cost', formatUsdText(totals.costUsd)],
        ]}
      />
      <p className="text-[11px] text-assistant-dim">Saved with each model request at the configured prices; compare with the provider’s bill.</p>
    </DiagnosticsChip>
  );
}
