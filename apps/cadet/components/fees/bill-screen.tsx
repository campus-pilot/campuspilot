'use client';

import { useQuery } from '@tanstack/react-query';
import { FileQuestionIcon, InfoIcon } from 'lucide-react';
import type { CadetBillDto } from '@campuspilot/api/routers/cadet/cadet.dto';
import { Card, CardContent } from '@campuspilot/ui/components/card';
import { Alert, AlertDescription } from '@campuspilot/ui/components/reui/alert';
import { Badge } from '@campuspilot/ui/components/reui/badge';
import { cn } from '@campuspilot/ui/lib/utils';

import { billPeriodLabel, formatCalendarDate, formatDate, formatMoney, isZeroMinor } from '@/lib/format';
import { orpc } from '@/lib/orpc';
import { EmptyState, ScreenError, ScreenHeader, ScreenLoading } from '../screen';

const ADJUSTMENT_LABELS: Record<CadetBillDto['adjustments'][number]['kind'], string> = {
  discount: 'Discount',
  waiver: 'Waiver',
  write_off: 'Written off',
  credit_correction: 'Correction',
  debit_correction: 'Added charge',
};

function Row({ label, sub, amount, className }: { label: string; sub?: string; amount: string; className?: string }) {
  return (
    <div className={cn('flex justify-between gap-3 px-4 py-3 text-sm', className)}>
      <span className="flex flex-col">
        {label}
        {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
      </span>
      <span className="tabular-nums">{amount}</span>
    </div>
  );
}

/**
 * Fee lines, the bill's own concessions and corrections, and the amount after
 * them. A reversed bill dims its lines and says nothing is due instead of
 * showing a payable amount.
 */
export function BillLines({ bill }: { bill: CadetBillDto }) {
  const money = (minor: string) => formatMoney(minor, bill.currency);
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col divide-y p-0">
        {bill.lines.map((line) => (
          <Row key={line.id} label={line.name} amount={money(line.amountMinor)} className={cn(bill.reversed && 'text-muted-foreground line-through')} />
        ))}
        <Row label="Total" amount={money(bill.totalAmountMinor)} className={cn('font-semibold', bill.reversed && 'text-muted-foreground line-through')} />
        {bill.adjustments.map((adjustment) => (
          <Row
            key={adjustment.id}
            label={ADJUSTMENT_LABELS[adjustment.kind]}
            sub={`${formatDate(adjustment.recordedAt)}${adjustment.reversed ? ' · reversed' : ''}`}
            amount={`${adjustment.kind === 'debit_correction' ? '+' : '−'} ${money(adjustment.amountMinor)}`}
            className={cn(
              adjustment.kind !== 'debit_correction' && 'text-emerald-700 dark:text-emerald-400',
              adjustment.reversed && 'text-muted-foreground line-through',
            )}
          />
        ))}
        {bill.reversed ? (
          <div className="bg-muted/50 px-4 py-3 text-base font-semibold">Reversed – nothing due</div>
        ) : isZeroMinor(bill.concessionsMinor) && isZeroMinor(bill.addedMinor) ? null : (
          <Row label="After concessions" amount={money(bill.netAmountMinor)} className="bg-muted/50 text-base font-semibold" />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One bill, line by line. Payments are credited to the student's account
 * rather than to a bill, so the bill shows no "paid" or "left to pay"
 * figure; the outstanding balance lives on Fees. There is no due date in the
 * school's data, so none is shown. Bill PDF download is deliberately out of
 * scope until documents can be served to cadets safely (see FeesScreen).
 */
export function BillScreen({ billId }: { billId: string }) {
  const bill = useQuery(orpc.getBill.queryOptions({ input: { billId } }));
  if (bill.isPending) return <ScreenLoading blocks={2} />;
  if (bill.isError) {
    const missing = (bill.error as { code?: string }).code === 'NOT_FOUND';
    return missing ? (
      <EmptyState icon={FileQuestionIcon} title="Bill not found" description="This bill does not exist or is not on your account." />
    ) : (
      <ScreenError title="Could not load this bill" error={bill.error} onRetry={() => void bill.refetch()} />
    );
  }
  const data = bill.data;
  return (
    <>
      <ScreenHeader
        title={billPeriodLabel(data.periodKey) ?? 'Bill'}
        description={`${data.billNumber} · issued ${formatCalendarDate(data.issueDate)}`}
        action={data.reversed ? <Badge variant="destructive-light" radius="full">Reversed</Badge> : null}
      />
      <BillLines bill={data} />
      <Alert variant="info">
        <InfoIcon />
        <AlertDescription>
          Payments are credited to your account, not to a single bill. Your outstanding balance is on the Fees screen.
        </AlertDescription>
      </Alert>
    </>
  );
}
