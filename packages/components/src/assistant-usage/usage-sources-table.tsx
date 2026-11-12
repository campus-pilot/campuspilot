import { formatTokenCount } from '@campuspilot/assistant-contract/usage';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@campuspilot/ui/components/table';

import { formatSpend, type UsageSourceRow } from './usage-model';

const count = new Intl.NumberFormat('en-IN');

/** Spend broken down by what the model requests were for (the assistant chat, question papers). */
export function UsageSourcesTable({ rows, inrPerUsd }: { rows: readonly UsageSourceRow[]; inrPerUsd: string | null }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Feature</TableHead>
          <TableHead className="text-right">Requests</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Spend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.source}>
            <TableCell>{row.label}</TableCell>
            <TableCell className="text-right tabular-nums">{count.format(row.requests)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatTokenCount(row.tokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatSpend(row.costUsd, inrPerUsd)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
