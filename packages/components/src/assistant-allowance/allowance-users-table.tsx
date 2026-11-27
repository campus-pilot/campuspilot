import { formatAllowancePercent } from '@campuspilot/assistant-contract/allowance';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@campuspilot/ui/components/table';

import { staffSignInLabel, type StaffSignInIdentity } from '../staff-account/staff-sign-in-label';

/** One person's share of the allowance, as `school.getAssistantAllowance` lists it. */
export type AllowanceUserRow = StaffSignInIdentity & {
  userId: string;
  /** Null for a deleted account. */
  name: string | null;
  usedPercent: number;
};

/**
 * Who to name in a row: the person's name, else how they sign in (a
 * phone-only account may have no name), else that the account was deleted.
 */
function personLabel(row: AllowanceUserRow): string {
  return row.name?.trim() || staffSignInLabel(row) || 'Deleted account';
}

/** Each person's share of this period's AI allowance, in the order given (largest first). Never an amount of money. */
export function AllowanceUsersTable({ rows }: { rows: readonly AllowanceUserRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Share of allowance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.userId}>
            <TableCell>{personLabel(row)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatAllowancePercent(row.usedPercent)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
