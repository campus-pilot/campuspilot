'use client';

import Link from 'next/link';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  BadgePercentIcon,
  ChevronRightIcon,
  InfoIcon,
  ReceiptIcon,
  Undo2Icon,
  type LucideIcon,
} from 'lucide-react';
import type { CadetFeeSummaryDto, CadetLedgerEntryDto } from '@campuspilot/api/routers/cadet/cadet.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent } from '@campuspilot/ui/components/card';
import { Alert, AlertDescription } from '@campuspilot/ui/components/reui/alert';
import { Badge } from '@campuspilot/ui/components/reui/badge';
import { IconTile } from '@campuspilot/ui/components/reui/icon-tile';
import { cn } from '@campuspilot/ui/lib/utils';

import { absMinor, formatBalance, formatDate, formatMoney, formatMonth, isZeroMinor } from '@/lib/format';
import { orpc } from '@/lib/orpc';
import { enrollmentLabel } from '@/lib/profile';
import { EmptyState, ScreenError, ScreenHeader, ScreenLoading, SectionLabel } from '../screen';

type FeeCurrency = CadetFeeSummaryDto['currencies'][number];

/** Same totals as the management summary: what is owed (or in credit), then billed / paid / concessions. */
export function BalanceCard({ row }: { row: FeeCurrency }) {
  const inCredit = !isZeroMinor(row.creditMinor);
  const stats = [
    { label: 'Billed', value: row.billedMinor },
    { label: 'Paid', value: row.paidMinor },
    { label: 'Concessions', value: row.concessionsMinor },
  ];
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{inCredit ? 'In credit' : 'Outstanding balance'}</span>
          <span className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatMoney(inCredit ? absMinor(row.creditMinor) : row.dueMinor, row.currency)}
          </span>
        </div>
        <dl className="grid grid-cols-3 divide-x rounded-lg bg-muted/50 py-2 text-center">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col gap-0.5 px-1">
              <dt className="text-[0.6875rem] text-muted-foreground">{stat.label}</dt>
              <dd className="text-sm font-semibold tabular-nums">{formatMoney(stat.value, row.currency)}</dd>
            </div>
          ))}
        </dl>
        {isZeroMinor(row.refundedMinor) ? null : (
          <p className="text-xs text-muted-foreground">Refunded to you: {formatMoney(row.refundedMinor, row.currency)}</p>
        )}
        <Button type="button" size="lg" disabled className="w-full">
          Pay online · coming soon
        </Button>
      </CardContent>
    </Card>
  );
}

const ENTRY_COPY: Record<CadetLedgerEntryDto['type'], { title: string; icon: LucideIcon; tone: string }> = {
  bill: { title: 'Bill', icon: ArrowUpRightIcon, tone: 'text-amber-600' },
  // Same wording as the management ledger (its type name in words).
  manual_debit_adjustment: { title: 'Manual debit adjustment', icon: ArrowUpRightIcon, tone: 'text-amber-600' },
  payment: { title: 'Payment received', icon: ArrowDownLeftIcon, tone: 'text-emerald-600' },
  discount: { title: 'Discount', icon: BadgePercentIcon, tone: 'text-violet-600' },
  waiver: { title: 'Waiver', icon: BadgePercentIcon, tone: 'text-violet-600' },
  write_off: { title: 'Written off', icon: BadgePercentIcon, tone: 'text-violet-600' },
  credit_correction: { title: 'Correction (credit)', icon: BadgePercentIcon, tone: 'text-violet-600' },
  debit_correction: { title: 'Correction (charge)', icon: ArrowUpRightIcon, tone: 'text-amber-600' },
  refund: { title: 'Refund', icon: ReceiptIcon, tone: 'text-sky-600' },
  reversal: { title: 'Reversal', icon: Undo2Icon, tone: 'text-muted-foreground' },
};

const METHOD_LABELS: Record<NonNullable<CadetLedgerEntryDto['paymentMethod']>, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  cheque: 'Cheque',
  other: 'Other',
};

/** Debit adds to what is owed, credit reduces it; the sign is spelled out so colour is never the only cue. */
function EntryAmount({ entry }: { entry: CadetLedgerEntryDto }) {
  const amount = formatMoney(entry.amountMinor, entry.currency);
  return entry.direction === 'debit' ? (
    <span className="text-sm font-semibold tabular-nums">+ {amount}</span>
  ) : (
    <span className="text-sm font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">− {amount}</span>
  );
}

export function LedgerRow({ entry }: { entry: CadetLedgerEntryDto }) {
  const { title, icon: Icon, tone } = ENTRY_COPY[entry.type];
  const detail = [
    formatDate(entry.effectiveAt, { timeZone: entry.timeZone, withYear: false }),
    entry.paymentMethod ? METHOD_LABELS[entry.paymentMethod] : null,
    entry.reference,
  ].filter(Boolean);
  const body = (
    <>
      <IconTile variant="soft" size="sm" className={cn('shrink-0', tone)}>
        <Icon />
      </IconTile>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-sm font-medium">
          {title}
          {entry.reversed ? <Badge variant="destructive-light" radius="full">Reversed</Badge> : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">{detail.join(' · ')}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <EntryAmount entry={entry} />
        <span className="text-[0.6875rem] text-muted-foreground tabular-nums">Bal {formatBalance(entry.runningBalanceMinor, entry.currency)}</span>
      </div>
      {entry.billId ? <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" /> : <span className="size-4 shrink-0" />}
    </>
  );
  const row = 'flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0';
  return entry.billId ? (
    <Link href={`/fees/${encodeURIComponent(entry.billId)}`} className={cn(row, 'hover:bg-muted/50')}>
      {body}
    </Link>
  ) : (
    <div className={row}>{body}</div>
  );
}

/** Entries grouped under month headings in each entry's session time zone, preserving newest-first order. */
export function groupByMonth(entries: CadetLedgerEntryDto[]) {
  const groups: { month: string; entries: CadetLedgerEntryDto[] }[] = [];
  for (const entry of entries) {
    const month = formatMonth(entry.effectiveAt, entry.timeZone);
    const last = groups.at(-1);
    if (last?.month === month) last.entries.push(entry);
    else groups.push({ month, entries: [entry] });
  }
  return groups;
}

export function LedgerList({ entries }: { entries: CadetLedgerEntryDto[] }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border">
      {groupByMonth(entries).map((group) => (
        <div key={group.month} className="flex flex-col">
          <div className="border-b bg-muted/50 px-3 py-1.5 text-[0.6875rem] font-semibold text-muted-foreground">{group.month}</div>
          {group.entries.map((entry) => (
            <LedgerRow key={entry.id} entry={entry} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * One chronological ledger, like the management admission ledger: bills,
 * payments, concessions and refunds together, each with the running balance
 * after it, loaded 20 entries at a time.
 */
function Ledger() {
  const ledger = useInfiniteQuery(
    orpc.listFeeLedger.infiniteOptions({
      input: (cursor: string | undefined) => (cursor ? { cursor } : {}),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.pagination.nextCursor ?? undefined,
    }),
  );
  if (ledger.isPending) return <ScreenLoading blocks={1} />;
  if (ledger.isError) return <ScreenError title="Could not load the ledger" error={ledger.error} onRetry={() => void ledger.refetch()} />;
  const entries = ledger.data.pages.flatMap((page) => page.items);
  if (entries.length === 0)
    return <EmptyState icon={ReceiptIcon} title="No fees yet" description="Bills, payments and concessions appear here once the school records them." />;
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Ledger</SectionLabel>
      <LedgerList entries={entries} />
      {ledger.hasNextPage ? (
        <Button type="button" variant="outline" disabled={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()}>
          {ledger.isFetchingNextPage ? 'Loading…' : 'Show older entries'}
        </Button>
      ) : null}
    </section>
  );
}

/**
 * The student's fees: balance, one ledger and bill links. Statement, receipt,
 * adjustment and bill PDF downloads are deliberately out of scope until the
 * document system can serve documents to cadets safely (today only staff can
 * generate and download them), so this screen offers no download buttons.
 */
export function FeesScreen() {
  const profile = useQuery(orpc.getProfile.queryOptions());
  const summary = useQuery(orpc.getFeeSummary.queryOptions());
  const enrollment = profile.data?.current ?? null;
  return (
    <>
      <ScreenHeader title="Fees" description={enrollmentLabel(enrollment)} />
      {summary.isPending ? (
        <ScreenLoading blocks={1} />
      ) : summary.isError ? (
        <ScreenError title="Could not load your balance" error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        summary.data.currencies.map((row) => <BalanceCard key={row.currency} row={row} />)
      )}
      <Ledger />
      <Alert variant="info">
        <InfoIcon />
        <AlertDescription>Paid at the school office? The entry appears here as soon as the office records it.</AlertDescription>
      </Alert>
    </>
  );
}
