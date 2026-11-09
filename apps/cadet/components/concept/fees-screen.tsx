import Link from 'next/link';
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  BadgePercentIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileTextIcon,
  FlagIcon,
  InfoIcon,
} from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent } from '@campuspilot/ui/components/card';
import { Alert, AlertDescription } from '@campuspilot/ui/components/reui/alert';
import { Badge } from '@campuspilot/ui/components/reui/badge';
import { IconTile } from '@campuspilot/ui/components/reui/icon-tile';
import { cn } from '@campuspilot/ui/lib/utils';

import { ScreenHeader, SectionLabel } from './concept-shell';
import { type Bill, type BillStatus, type LedgerEntry, type LedgerEntryType, feeSummary, formatInr, ledger, student } from './mock-data';

const statusBadge: Record<BillStatus, { label: string; variant: 'success-light' | 'warning-light' | 'destructive-light' }> = {
  paid: { label: 'Paid', variant: 'success-light' },
  due: { label: 'Due', variant: 'warning-light' },
  overdue: { label: 'Overdue', variant: 'destructive-light' },
};

export function BillStatusBadge({ status }: { status: BillStatus }) {
  const { label, variant } = statusBadge[status];
  return (
    <Badge variant={variant} radius="full">
      {label}
    </Badge>
  );
}

/** Same totals as the management summary cards: outstanding first, then the session's billed / paid / concessions. */
function BalanceCard() {
  const stats = [
    { label: 'Billed', value: feeSummary.billed },
    { label: 'Paid', value: feeSummary.paid },
    { label: 'Concessions', value: feeSummary.concessions },
  ];
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Outstanding balance</span>
            <span className="text-3xl font-semibold tracking-tight tabular-nums">{formatInr(feeSummary.outstanding)}</span>
          </div>
          <Badge variant="warning-light" radius="full">Due {feeSummary.nextDueOn}</Badge>
        </div>
        <dl className="grid grid-cols-3 divide-x rounded-lg bg-muted/50 py-2 text-center">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col gap-0.5">
              <dt className="text-[0.6875rem] text-muted-foreground">{stat.label}</dt>
              <dd className="text-sm font-semibold tabular-nums">{formatInr(stat.value)}</dd>
            </div>
          ))}
        </dl>
        <Button size="lg" disabled className="w-full">
          Pay online · coming soon
        </Button>
      </CardContent>
    </Card>
  );
}

const entryStyle: Record<LedgerEntryType, { icon: typeof FileTextIcon; tone: string }> = {
  bill: { icon: ArrowUpRightIcon, tone: 'text-amber-600' },
  payment: { icon: ArrowDownLeftIcon, tone: 'text-emerald-600' },
  discount: { icon: BadgePercentIcon, tone: 'text-violet-600' },
  waiver: { icon: BadgePercentIcon, tone: 'text-violet-600' },
  refund: { icon: ArrowUpRightIcon, tone: 'text-sky-600' },
  opening: { icon: FlagIcon, tone: 'text-muted-foreground' },
};

/** Debit adds to what is owed, credit reduces it; the sign is spelled out so colour is never the only cue. */
function EntryAmount({ entry }: { entry: LedgerEntry }) {
  if (entry.debit !== null) return <span className="text-sm font-semibold tabular-nums">+ {formatInr(entry.debit)}</span>;
  if (entry.credit !== null)
    return <span className="text-sm font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">− {formatInr(entry.credit)}</span>;
  return <span className="text-sm font-semibold tabular-nums">{formatInr(entry.balance)}</span>;
}

/** The trailing control: bills open their detail, receipts and concession notes download. */
function EntryAction({ entry }: { entry: LedgerEntry }) {
  if (entry.billId) return <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />;
  if (entry.type === 'opening') return <span className="size-4 shrink-0" />;
  return (
    <Button variant="ghost" size="icon-lg" className="-mr-2 shrink-0" aria-label={`Download ${entry.reference}`}>
      <DownloadIcon />
    </Button>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const { icon: Icon, tone } = entryStyle[entry.type];
  const body = (
    <>
      <IconTile variant="soft" size="sm" className={cn('shrink-0', tone)}>
        <Icon />
      </IconTile>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-sm font-medium">
          {entry.title}
          {entry.billStatus && entry.billStatus !== 'paid' ? <BillStatusBadge status={entry.billStatus} /> : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {entry.date} · {entry.detail} · {entry.reference}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <EntryAmount entry={entry} />
        <span className="text-[0.6875rem] text-muted-foreground tabular-nums">Bal {formatInr(entry.balance)}</span>
      </div>
      <EntryAction entry={entry} />
    </>
  );
  const row = 'flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0';
  return entry.billId ? (
    <Link href={`/concept/fees/${entry.billId}`} className={cn(row, 'hover:bg-muted/50')}>
      {body}
    </Link>
  ) : (
    <div className={row}>{body}</div>
  );
}

/** Ledger entries grouped under month headings, preserving the newest-first order. */
function groupByMonth(entries: LedgerEntry[]) {
  const groups: { month: string; entries: LedgerEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last?.month === entry.month) last.entries.push(entry);
    else groups.push({ month: entry.month, entries: [entry] });
  }
  return groups;
}

/**
 * One chronological ledger, like the management admission ledger: bills,
 * payments, concessions and refunds together, each with the running balance
 * after it. A phone gets rows instead of the nine-column table.
 */
function Ledger() {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel action={<span className="text-xs text-muted-foreground">Session {student.session}</span>}>Ledger</SectionLabel>
      <div className="flex flex-col overflow-hidden rounded-lg border">
        {groupByMonth(ledger).map((group) => (
          <div key={group.month} className="flex flex-col">
            <div className="border-b bg-muted/50 px-3 py-1.5 text-[0.6875rem] font-semibold text-muted-foreground">{group.month}</div>
            {group.entries.map((entry) => (
              <LedgerRow key={entry.id} entry={entry} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function FeesScreen() {
  return (
    <>
      <ScreenHeader
        title="Fees"
        description={`${student.className} ${student.section} · ${student.session}`}
        action={
          <Button variant="outline" size="lg">
            <DownloadIcon data-icon="inline-start" /> Statement
          </Button>
        }
      />
      <BalanceCard />
      <Ledger />
      <Alert variant="info">
        <InfoIcon />
        <AlertDescription>Paid at the school office? The entry appears here as soon as the office records it.</AlertDescription>
      </Alert>
    </>
  );
}

function BillLines({ bill }: { bill: Bill }) {
  const credited = bill.credits.reduce((sum, credit) => sum + credit.amount, 0);
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col divide-y p-0">
        {bill.lines.map((line) => (
          <div key={line.label} className="flex justify-between px-4 py-3 text-sm">
            <span>{line.label}</span>
            <span className="tabular-nums">{formatInr(line.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between px-4 py-3 text-sm font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatInr(bill.total)}</span>
        </div>
        {bill.credits.map((credit) => (
          <div key={credit.reference} className="flex justify-between gap-3 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
            <span className="flex flex-col">
              {credit.label}
              <span className="text-xs text-muted-foreground">{credit.reference}</span>
            </span>
            <span className="tabular-nums">− {formatInr(credit.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between bg-muted/50 px-4 py-3 text-base font-semibold">
          <span>Left to pay</span>
          <span className="tabular-nums">{formatInr(bill.total - credited)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/** Line-by-line bill with every payment and concession applied to it, so a guardian can match office receipts. */
export function BillDetailScreen({ bill }: { bill: Bill }) {
  const left = bill.total - bill.credits.reduce((sum, credit) => sum + credit.amount, 0);
  return (
    <>
      <ScreenHeader title={bill.period} description={`${bill.number} · issued ${bill.issuedOn}`} action={<BillStatusBadge status={bill.status} />} />
      <BillLines bill={bill} />
      <p className="text-xs text-muted-foreground">Due by {bill.dueOn}. Late fee rules are set by the school.</p>
      <div className="flex flex-col gap-2">
        <Button size="lg" variant="outline" className="w-full">
          <DownloadIcon data-icon="inline-start" /> Download bill (PDF)
        </Button>
        {left > 0 ? (
          <Button size="lg" disabled className="w-full">
            Pay {formatInr(left)} online · coming soon
          </Button>
        ) : null}
      </div>
    </>
  );
}
