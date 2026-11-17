'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { schoolTierCatalogue, type SchoolTier } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type {
  SchoolBillingDto,
  SchoolBillingPeriodDto,
  SchoolInvoiceDto,
} from '@campuspilot/api/routers/system-admin/school-billing/school-billing.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { toast } from '@campuspilot/ui/lib/toast';
import { Plus } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { formatPaise } from '@/lib/money';
import { formatIstDate } from '@/lib/trial-dates';
import { useRefreshSchoolPlan } from '../school-plan-effect';
import { AddPeriodsDialog } from './add-periods-dialog';

const KIND_LABELS = { trial: 'Trial', paid: 'Paid', complimentary: 'Free' } as const;

/** When a period really ended: cut short, or its own end. */
const periodEnd = (period: SchoolBillingPeriodDto) =>
  period.endedAt && period.endedAt < period.endsAt ? period.endedAt : period.endsAt;

/** Where a period stands now; one cut short before it began was voided or replaced. */
function periodState(period: SchoolBillingPeriodDto, now: Date): string {
  if (period.active) return 'Current';
  if (period.endedAt && period.endedAt.getTime() === period.startsAt.getTime()) return 'Cancelled';
  if (period.startsAt > now) return 'Upcoming';
  return period.endedAt && period.endedAt < period.endsAt ? 'Ended early' : 'Over';
}

/** Cancelling an upcoming free period, so it never starts; paid ones are cancelled by voiding their invoice. */
function CancelPeriodButton({ schoolId, period }: { schoolId: string; period: SchoolBillingPeriodDto }) {
  const refresh = useRefreshSchoolPlan(schoolId);
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation(
    orpc.systemAdmin.endSchoolBillingPeriod.mutationOptions({
      onSuccess: () => {
        refresh();
        toast.success('Free period cancelled.');
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Unable to cancel the free period.'),
      onSettled: () => setConfirming(false),
    }),
  );
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Cancel
      </Button>
      <ConfirmationDialog
        open={confirming}
        title="Cancel this free period?"
        description={`The free ${schoolTierCatalogue[period.tier].label} period from ${formatIstDate(period.startsAt)} will not start. Periods booked after it keep their dates. This cannot be undone.`}
        confirmLabel={cancel.isPending ? 'Cancelling…' : 'Cancel period'}
        confirmVariant="destructive"
        pending={cancel.isPending}
        onOpenChange={setConfirming}
        onConfirm={() => cancel.mutate({ id: schoolId, periodId: period.id })}
      />
    </>
  );
}

function PeriodRow({ schoolId, period, now }: { schoolId: string; period: SchoolBillingPeriodDto; now: Date }) {
  const state = periodState(period, now);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span className="flex items-center gap-2">
        <Badge variant={period.active ? 'secondary' : 'outline'}>{KIND_LABELS[period.kind]}</Badge>
        {schoolTierCatalogue[period.tier].label}
      </span>
      <span className="flex items-center gap-2 text-muted-foreground">
        {formatIstDate(period.startsAt)} to {formatIstDate(periodEnd(period))} · {state}
        {state === 'Upcoming' && period.kind === 'complimentary' ? <CancelPeriodButton schoolId={schoolId} period={period} /> : null}
      </span>
    </li>
  );
}

const PERIOD_LIST_LENGTH = 8;

/**
 * Periods from the newest; the history stays in the database however long it
 * grows. Upcoming periods are always listed, so each one can be cancelled.
 */
function PeriodList({ schoolId, periods }: { schoolId: string; periods: SchoolBillingPeriodDto[] }) {
  const now = new Date();
  if (periods.length === 0) return <p className="text-sm text-muted-foreground">No billing periods yet.</p>;
  const upcoming = periods.filter((period) => periodState(period, now) === 'Upcoming').length;
  const shown = Math.max(PERIOD_LIST_LENGTH, upcoming);
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col divide-y">
        {periods.slice(0, shown).map((period) => (
          <PeriodRow key={period.id} schoolId={schoolId} period={period} now={now} />
        ))}
      </ul>
      {periods.length > shown ? (
        <p className="text-xs text-muted-foreground">And {periods.length - shown} earlier.</p>
      ) : null}
    </div>
  );
}

/** Voiding an invoice, confirmed with what it does to the periods it paid for. */
function VoidInvoiceButton({ schoolId, invoice }: { schoolId: string; invoice: SchoolInvoiceDto }) {
  const refresh = useRefreshSchoolPlan(schoolId);
  const [confirming, setConfirming] = useState(false);
  const voidInvoice = useMutation(
    orpc.systemAdmin.voidSchoolInvoice.mutationOptions({
      onSuccess: () => {
        refresh();
        toast.success('Invoice voided.');
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Unable to void the invoice.'),
      onSettled: () => setConfirming(false),
    }),
  );
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Void
      </Button>
      <ConfirmationDialog
        open={confirming}
        title="Void this invoice?"
        description="For a payment recorded by mistake or refunded. Its periods that are not over end now, and upcoming ones never start. Periods already over stay in the history. This cannot be undone."
        confirmLabel={voidInvoice.isPending ? 'Voiding…' : 'Void invoice'}
        confirmVariant="destructive"
        pending={voidInvoice.isPending}
        onOpenChange={setConfirming}
        onConfirm={() => voidInvoice.mutate({ id: schoolId, invoiceId: invoice.id })}
      />
    </>
  );
}

function InvoiceRow({ schoolId, invoice }: { schoolId: string; invoice: SchoolInvoiceDto }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">
          {formatPaise(invoice.amountMinor)} · {schoolTierCatalogue[invoice.tier].label} × {invoice.periodCount}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatIstDate(invoice.periodStart)} to {formatIstDate(invoice.periodEnd)}
          {invoice.paymentReference ? ` · ${invoice.paymentReference}` : ''}
        </span>
      </span>
      {invoice.status === 'void' ? <Badge variant="outline">Void</Badge> : <VoidInvoiceButton schoolId={schoolId} invoice={invoice} />}
    </li>
  );
}

function InvoiceList({ schoolId, invoices }: { schoolId: string; invoices: SchoolInvoiceDto[] }) {
  if (invoices.length === 0) return <p className="text-sm text-muted-foreground">No payments recorded yet.</p>;
  return (
    <ul className="flex flex-col divide-y">
      {invoices.map((invoice) => (
        <InvoiceRow key={invoice.id} schoolId={schoolId} invoice={invoice} />
      ))}
    </ul>
  );
}

/** One line on where the school's coverage stands. */
function coverageText(billing: SchoolBillingDto): string {
  if (!billing.coveredUntil) {
    return 'No period covers the school now. It has its standing tier if it has one, and is read-only otherwise, until a trial, payment or free period starts.';
  }
  return `Covered until ${formatIstDate(billing.coveredUntil)}. After that the school has its standing tier if it has one, and is read-only otherwise, unless another period starts.`;
}

function BillingBody({ schoolId, billing, defaultTier }: { schoolId: string; billing: SchoolBillingDto; defaultTier: SchoolTier }) {
  const [adding, setAdding] = useState(false);
  return (
    <CardContent className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">{coverageText(billing)}</p>
        <Button type="button" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Add periods
        </Button>
      </div>
      <section className="flex flex-col gap-2" aria-label="Billing periods">
        <h3 className="text-sm font-medium">Periods</h3>
        <PeriodList schoolId={schoolId} periods={billing.periods} />
      </section>
      <section className="flex flex-col gap-2" aria-label="Payments">
        <h3 className="text-sm font-medium">Payments</h3>
        <InvoiceList schoolId={schoolId} invoices={billing.invoices} />
      </section>
      {adding ? (
        <AddPeriodsDialog schoolId={schoolId} billing={billing} defaultTier={defaultTier} onClose={() => setAdding(false)} />
      ) : null}
    </CardContent>
  );
}

/**
 * The school's billing (docs/school-billing.md): until when it is covered,
 * every 28-day period (trial, paid, free) and every payment recorded by hand,
 * with Add periods and Void. There is no grace: when coverage runs out the
 * school is read-only until the next payment is recorded.
 */
export function SchoolBillingCard({ schoolId, defaultTier }: { schoolId: string; defaultTier: SchoolTier }) {
  const billingQuery = useQuery(orpc.systemAdmin.getSchoolBilling.queryOptions({ input: { id: schoolId } }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
        <CardDescription>
          Periods of 28 days from the day billing started. Record a payment for one or more periods ahead, or give free
          periods.
        </CardDescription>
      </CardHeader>
      {billingQuery.data ? (
        <BillingBody schoolId={schoolId} billing={billingQuery.data} defaultTier={defaultTier} />
      ) : (
        <CardContent>
          {billingQuery.isError ? (
            <Button type="button" variant="outline" onClick={() => void billingQuery.refetch()}>
              Retry
            </Button>
          ) : (
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          )}
        </CardContent>
      )}
    </Card>
  );
}
