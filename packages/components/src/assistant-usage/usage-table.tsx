import { formatTokenCount } from '@campuspilot/assistant-contract/usage';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@campuspilot/ui/components/table';

import { formatSpend, type UsagePeriod } from './usage-model';

const count = new Intl.NumberFormat('en-IN');

/** Spend per day or month, newest first, with requests and tokens. */
export function UsageTable({ periods, inrPerUsd, periodLabel }: { periods: readonly UsagePeriod[]; inrPerUsd: string | null; periodLabel: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{periodLabel}</TableHead>
          <TableHead className="text-right">Requests</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Spend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...periods].reverse().map((period) => (
          <TableRow key={period.period}>
            <TableCell>{period.label}</TableCell>
            <TableCell className="text-right tabular-nums">{count.format(period.requests)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatTokenCount(period.tokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatSpend(period.costUsd, inrPerUsd)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
