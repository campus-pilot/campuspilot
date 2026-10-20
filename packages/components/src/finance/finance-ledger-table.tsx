import { Badge } from "@campuspilot/ui/components/badge";
import { Button } from "@campuspilot/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@campuspilot/ui/components/table";
import { formatMinor } from "./finance-model";

export type FinanceLedgerRow = {
  id: string;
  effectiveAt: Date | string;
  effectiveAtLabel?: string;
  sessionLabel: string;
  type: string;
  debitMinor?: string;
  creditMinor?: string;
  currency: string;
  runningBalanceMinor: string;
  reference: string;
  reversed: boolean;
  recordedBy: string;
  onOpen?: () => void;
};

export function FinanceLedgerTable({ rows }: { rows: FinanceLedgerRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table aria-label="Admission ledger" className="min-w-[900px]">
        <TableHeader className="bg-muted/40">
          <TableRow>
            <TableHead>Effective date</TableHead>
            <TableHead>Session</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>Recorder</TableHead>
            <TableHead className="text-right">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? rows.map((row) => (
            <TableRow
              key={row.id}
            >
              <TableCell>{row.effectiveAtLabel ?? String(row.effectiveAt)}</TableCell>
              <TableCell>{row.sessionLabel}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="capitalize">{row.type.replaceAll("_", " ")}</span>
                  {row.reversed ? <Badge variant="outline">Reversed</Badge> : null}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.debitMinor ? formatMinor(row.debitMinor, row.currency) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.creditMinor ? formatMinor(row.creditMinor, row.currency) : "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">{row.reference}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatMinor(row.runningBalanceMinor, row.currency)}
              </TableCell>
              <TableCell>{row.recordedBy}</TableCell>
              <TableCell className="text-right">{row.onOpen ? <Button type="button" size="sm" variant="outline" onClick={row.onOpen}>View</Button> : null}</TableCell>
            </TableRow>
          )) : (
            <TableRow>
              <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                No ledger entries match this view.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
