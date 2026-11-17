'use client';

import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { addBillingPeriods, BILLING_PERIOD_DAYS, MAX_PERIODS_PER_INVOICE } from '@campuspilot/api/billing/billing.contract';
import { SCHOOL_TIERS, schoolTierCatalogue, type SchoolTier } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { SchoolBillingDto } from '@campuspilot/api/routers/system-admin/school-billing/school-billing.dto';
import { OptionSelect, type OptionSelectOption } from '@campuspilot/components/option-select';
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@campuspilot/ui/components/radio-group';
import { toast } from '@campuspilot/ui/lib/toast';
import { client, orpc } from '@/lib/orpc';
import { formatPaise, rupeesToPaise } from '@/lib/money';
import { formatIstDate } from '@/lib/trial-dates';
import { FieldErrors } from '../users/field-errors';
import { useRefreshSchoolPlan } from '../school-plan-effect';

const TIER_OPTIONS: OptionSelectOption<SchoolTier>[] = SCHOOL_TIERS.map((tier) => ({ value: tier, label: schoolTierCatalogue[tier].label }));

/** The form as typed: the amount stays text until it is sent, so blank means "the price × periods". */
const addPeriodsFormSchema = z
  .object({
    kind: z.enum(['paid', 'complimentary']),
    tier: z.enum(SCHOOL_TIERS),
    periodCount: z
      .number({ message: 'Enter a number.' })
      .int('Enter a whole number.')
      .min(1, 'At least one period.')
      .max(MAX_PERIODS_PER_INVOICE, `At most ${MAX_PERIODS_PER_INVOICE} periods at a time.`),
    start: z.enum(['after_current', 'now']),
    amount: z.string(),
    paymentReference: z.string().trim().max(200),
    note: z.string().trim().max(1000),
  })
  .refine(({ kind, amount }) => kind !== 'paid' || amount.trim() === '' || rupeesToPaise(amount) !== null, {
    message: 'Enter an amount in rupees, like 1999 or 1999.50.',
    path: ['amount'],
  });

type AddPeriodsValues = z.infer<typeof addPeriodsFormSchema>;

/** The active price of each tier, in paise. */
function useActivePrices() {
  const pricesQuery = useQuery(orpc.systemAdmin.listSubscriptionPrices.queryOptions());
  const prices = new Map<SchoolTier, number>();
  for (const price of pricesQuery.data ?? []) if (price.active) prices.set(price.tier, price.unitAmountMinor);
  return prices;
}

function useAddPeriodsForm(schoolId: string, defaultTier: SchoolTier, onDone: () => void) {
  const refresh = useRefreshSchoolPlan(schoolId);
  return useForm({
    defaultValues: {
      kind: 'paid',
      tier: defaultTier,
      periodCount: 1,
      start: 'after_current',
      amount: '',
      paymentReference: '',
      note: '',
    } as AddPeriodsValues,
    validators: { onSubmit: addPeriodsFormSchema },
    onSubmit: async ({ value, formApi }) => {
      formApi.setErrorMap({});
      try {
        const common = { id: schoolId, tier: value.tier, periodCount: value.periodCount, start: value.start };
        await client.systemAdmin.addSchoolBillingPeriods(
          value.kind === 'paid'
            ? {
                ...common,
                kind: 'paid',
                amountMinor: value.amount.trim() === '' ? undefined : (rupeesToPaise(value.amount) ?? undefined),
                paymentReference: value.paymentReference || undefined,
                note: value.note || undefined,
              }
            : { ...common, kind: 'complimentary' },
        );
        refresh();
        toast.success(`${value.periodCount} ${value.kind === 'paid' ? 'paid' : 'free'} period${value.periodCount === 1 ? '' : 's'} added.`);
        onDone();
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to add the periods.', fields: {} },
        });
      }
    },
  });
}

type AddPeriodsForm = ReturnType<typeof useAddPeriodsForm>;

function KindAndStartFields({ form }: { form: AddPeriodsForm }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <form.Field name="kind">
        {(field) => (
          <div className="flex flex-1 flex-col gap-2">
            <Label>Type</Label>
            <RadioGroup value={field.state.value} onValueChange={(value) => field.handleChange(value as AddPeriodsValues['kind'])}>
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="paid" /> Paid (records the payment)
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="complimentary" /> Free (a gift, no invoice)
              </Label>
            </RadioGroup>
          </div>
        )}
      </form.Field>
      <form.Field name="start">
        {(field) => (
          <div className="flex flex-1 flex-col gap-2">
            <Label>Starts</Label>
            <RadioGroup value={field.state.value} onValueChange={(value) => field.handleChange(value as AddPeriodsValues['start'])}>
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="after_current" /> After the periods already booked
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="now" /> Now (ends the current period)
              </Label>
            </RadioGroup>
          </div>
        )}
      </form.Field>
    </div>
  );
}

function TierAndCountFields({ form }: { form: AddPeriodsForm }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <form.Field name="tier">
        {(field) => (
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="add-periods-tier">Tier</Label>
            <OptionSelect
              value={field.state.value}
              options={TIER_OPTIONS}
              onValueChange={(tier) => field.handleChange(tier)}
              triggerProps={{ id: 'add-periods-tier', className: 'w-full' }}
            />
          </div>
        )}
      </form.Field>
      <form.Field name="periodCount">
        {(field) => (
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="add-periods-count">Periods of {BILLING_PERIOD_DAYS} days</Label>
            <Input
              id="add-periods-count"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_PERIODS_PER_INVOICE}
              value={Number.isNaN(field.state.value) ? '' : field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.valueAsNumber)}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
    </div>
  );
}

function PaymentFields({ form, prices }: { form: AddPeriodsForm; prices: Map<SchoolTier, number> }) {
  return (
    <form.Subscribe selector={(state) => ({ kind: state.values.kind, tier: state.values.tier, count: state.values.periodCount })}>
      {({ kind, tier, count }) => {
        if (kind !== 'paid') return null;
        const unit = prices.get(tier);
        return (
          <div className="flex flex-col gap-4">
            <form.Field name="amount">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="add-periods-amount">Amount received (₹)</Label>
                  <Input
                    id="add-periods-amount"
                    inputMode="decimal"
                    placeholder={unit === undefined || Number.isNaN(count) ? '' : String((unit * count) / 100)}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {unit === undefined
                      ? `No price is set for ${schoolTierCatalogue[tier].label}. Set one on the Pricing page first.`
                      : `Leave blank for the price: ${formatPaise(unit)} × ${Number.isNaN(count) ? 0 : count}. Enter less to record a discount.`}
                  </p>
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="paymentReference">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="add-periods-reference">Payment reference (optional)</Label>
                  <Input
                    id="add-periods-reference"
                    placeholder="UPI reference, cheque number…"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </div>
              )}
            </form.Field>
          </div>
        );
      }}
    </form.Subscribe>
  );
}

/** Where the new periods would run, said before saving. */
function CoverageSummary({ form, billing }: { form: AddPeriodsForm; billing: SchoolBillingDto }) {
  return (
    <form.Subscribe selector={(state) => ({ start: state.values.start, count: state.values.periodCount })}>
      {({ start, count }) => {
        if (Number.isNaN(count) || count < 1) return null;
        const from = start === 'now' ? new Date() : (billing.bookedUntil ?? new Date());
        return (
          <p className="text-xs text-muted-foreground">
            Covers {formatIstDate(from)} to {formatIstDate(addBillingPeriods(from, count))}.
          </p>
        );
      }}
    </form.Subscribe>
  );
}

/**
 * Adds paid or free 28-day periods to a school (docs/school-billing.md): a
 * payment received by hand, possibly for several periods ahead, or a gift.
 * Mounted while open, so every opening starts clean.
 */
export function AddPeriodsDialog({
  schoolId,
  billing,
  defaultTier,
  onClose,
}: {
  schoolId: string;
  billing: SchoolBillingDto;
  defaultTier: SchoolTier;
  onClose: () => void;
}) {
  const prices = useActivePrices();
  const form = useAddPeriodsForm(schoolId, defaultTier, onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && !form.state.isSubmitting && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add billing periods</DialogTitle>
          <DialogDescription>
            Record a payment for one or more {BILLING_PERIOD_DAYS}-day periods, or give free periods.
          </DialogDescription>
        </DialogHeader>
        <form
          id="add-billing-periods"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <KindAndStartFields form={form} />
          <TierAndCountFields form={form} />
          <PaymentFields form={form} prices={prices} />
          <CoverageSummary form={form} billing={billing} />
          <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
            {(error) =>
              error && typeof error === 'object' && 'form' in error ? (
                <p role="alert" className="text-xs text-destructive">{String(error.form)}</p>
              ) : null
            }
          </form.Subscribe>
        </form>
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" form="add-billing-periods" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? 'Adding…' : 'Add periods'}
              </Button>
            </DialogFooter>
          )}
        </form.Subscribe>
      </DialogContent>
    </Dialog>
  );
}
