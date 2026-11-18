'use client';

import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { BILLING_PERIOD_DAYS } from '@campuspilot/api/billing/billing.contract';
import { SCHOOL_TIERS, schoolTierCatalogue, type SchoolTier } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { SubscriptionPriceDto } from '@campuspilot/api/routers/system-admin/school-billing/school-billing.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
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
import { toast } from '@campuspilot/ui/lib/toast';
import { client, orpc } from '@/lib/orpc';
import { formatPaise, rupeesToPaise } from '@/lib/money';
import { formatIstDate } from '@/lib/trial-dates';
import { FieldErrors } from '../users/field-errors';

const priceFormSchema = z.object({
  amount: z.string().refine((value) => rupeesToPaise(value) !== null, 'Enter an amount in rupees, like 1999 or 1999.50.'),
});

function usePriceForm(tier: SchoolTier, current: SubscriptionPriceDto | undefined, onDone: () => void) {
  const queryClient = useQueryClient();
  return useForm({
    defaultValues: { amount: current ? String(current.unitAmountMinor / 100) : '' },
    validators: { onSubmit: priceFormSchema },
    onSubmit: async ({ value, formApi }) => {
      formApi.setErrorMap({});
      try {
        await client.systemAdmin.setSubscriptionPrice({ tier, unitAmountMinor: rupeesToPaise(value.amount)! });
        await queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSubscriptionPrices.key() });
        toast.success(`${schoolTierCatalogue[tier].label} price saved.`);
        onDone();
      } catch (error) {
        formApi.setErrorMap({ onSubmit: { form: error instanceof Error ? error.message : 'Unable to save the price.', fields: {} } });
      }
    },
  });
}

/** Sets a tier's price. Earlier prices are kept, so invoices already recorded keep theirs. */
function EditPriceDialog({ tier, current, onClose }: { tier: SchoolTier; current: SubscriptionPriceDto | undefined; onClose: () => void }) {
  const form = usePriceForm(tier, current, onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && !form.state.isSubmitting && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{schoolTierCatalogue[tier].label} price</DialogTitle>
          <DialogDescription>
            The price of one {BILLING_PERIOD_DAYS}-day period. Payments already recorded keep the price they were charged at.
          </DialogDescription>
        </DialogHeader>
        <form
          id="edit-price"
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="amount">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor="price-amount">Price (₹)</Label>
                <Input
                  id="price-amount"
                  inputMode="decimal"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
            {(error) =>
              error && typeof error === 'object' && 'form' in error ? <p className="text-xs text-destructive">{String(error.form)}</p> : null
            }
          </form.Subscribe>
        </form>
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" form="edit-price" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save price'}
              </Button>
            </DialogFooter>
          )}
        </form.Subscribe>
      </DialogContent>
    </Dialog>
  );
}

function TierPriceRow({ tier, current, onEdit }: { tier: SchoolTier; current: SubscriptionPriceDto | undefined; onEdit: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{schoolTierCatalogue[tier].label}</span>
        <span className="text-xs text-muted-foreground">
          {current ? `Since ${formatIstDate(current.createdAt)}` : 'No price set: payments for this tier cannot be recorded yet.'}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <span className="text-sm">{current ? `${formatPaise(current.unitAmountMinor)} / ${BILLING_PERIOD_DAYS} days` : '—'}</span>
        <Button type="button" size="sm" variant="outline" onClick={onEdit}>
          {current ? 'Change' : 'Set price'}
        </Button>
      </span>
    </li>
  );
}

/**
 * The price of one 28-day billing period per tier (docs/school-billing.md).
 * Payments recorded on a school's Billing card default to the price × the
 * number of periods.
 */
export function SubscriptionPricing() {
  const pricesQuery = useQuery(orpc.systemAdmin.listSubscriptionPrices.queryOptions());
  const [editing, setEditing] = useState<SchoolTier>();
  const active = new Map((pricesQuery.data ?? []).filter(({ active }) => active).map((price) => [price.tier, price]));
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pricing</h1>
        <p className="text-sm text-muted-foreground">What one {BILLING_PERIOD_DAYS}-day period of each tier costs a school.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tiers</CardTitle>
          <CardDescription>Prices in INR. Changing a price affects payments recorded from now on.</CardDescription>
        </CardHeader>
        <CardContent>
          {pricesQuery.isError ? (
            <Button type="button" variant="outline" onClick={() => void pricesQuery.refetch()}>
              Retry
            </Button>
          ) : (
            <ul className="flex flex-col divide-y">
              {SCHOOL_TIERS.map((tier) => (
                <TierPriceRow key={tier} tier={tier} current={active.get(tier)} onEdit={() => setEditing(tier)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {editing ? <EditPriceDialog key={editing} tier={editing} current={active.get(editing)} onClose={() => setEditing(undefined)} /> : null}
    </section>
  );
}
