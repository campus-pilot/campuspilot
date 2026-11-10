import type { AssistantUsage } from '@campuspilot/api/routers/school/assistant-access/assistant-access.dto';
import { formatSpend } from '@campuspilot/components/assistant-usage';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@campuspilot/ui/components/table';

const count = new Intl.NumberFormat('en-IN');

/** One set of prices as saved (USD per million tokens: input / output / cache read / cache write). */
const priceText = (price: AssistantUsage['models'][number]['prices'][number]) =>
  `$${price.inputUsdPerMtok} / $${price.outputUsdPerMtok} / $${price.cacheReadUsdPerMtok} / $${price.cacheWriteUsdPerMtok}`;

/**
 * Spend per provider and model with tokens and the prices that were saved,
 * for comparing with each provider's billing console (compare months: the
 * consoles group days in their own time zone).
 */
export function ModelTotalsTable({ models, inrPerUsd }: { models: AssistantUsage['models']; inrPerUsd: string | null }) {
  if (models.length === 0) return <p className="text-sm text-muted-foreground">No model requests in this range.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Provider and model</TableHead>
          <TableHead className="text-right">Requests</TableHead>
          <TableHead className="text-right">Input</TableHead>
          <TableHead className="text-right">Output</TableHead>
          <TableHead className="text-right">Cache read</TableHead>
          <TableHead className="text-right">Cache write</TableHead>
          <TableHead className="text-right">Spend</TableHead>
          <TableHead>Prices per 1M tokens (in / out / cache read / cache write)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((model) => (
          <TableRow key={`${model.provider}:${model.model}`}>
            <TableCell>
              {model.provider} · <span className="font-mono text-xs">{model.model}</span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{count.format(model.requests)}</TableCell>
            <TableCell className="text-right tabular-nums">{count.format(model.inputTokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{count.format(model.outputTokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{count.format(model.cacheReadInputTokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{count.format(model.cacheCreationInputTokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatSpend(model.costUsd, inrPerUsd)}</TableCell>
            <TableCell className="flex flex-col gap-0.5 text-xs tabular-nums">
              {model.prices.map((price) => (
                <span key={priceText(price)}>
                  {priceText(price)} ({count.format(price.requests)} requests)
                </span>
              ))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
