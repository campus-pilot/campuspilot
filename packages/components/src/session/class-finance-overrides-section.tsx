'use client';

import { useForm } from '@tanstack/react-form';
import {
  formatCurrencyMinorNumber,
  parseCurrencyDecimalToMinorNumber,
  type CurrencyCode,
} from '@campuspilot/db/schema/jsonb/currencies';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@campuspilot/ui/components/table';
import { Building2 } from 'lucide-react';
import { z } from 'zod';
import type {
  FinanceClassOverrides,
  FinanceElement,
  PersistedFinanceSchemaConfig,
  SessionFinanceClassDto,
} from './types';

export interface ClassFinanceOverridesSectionProps {
  financeConfig: PersistedFinanceSchemaConfig | null;
  classOverrides: FinanceClassOverrides;
  classes: SessionFinanceClassDto[];
  onChange?: (classOverrides: FinanceClassOverrides) => void;
}

function updateOverride(
  classOverrides: FinanceClassOverrides,
  classSlug: string,
  elementSlug: string,
  amountMinor: number | undefined,
) {
  const nextClassValues = { ...classOverrides[classSlug] };
  if (amountMinor === undefined) delete nextClassValues[elementSlug];
  else nextClassValues[elementSlug] = amountMinor;

  const nextOverrides = { ...classOverrides };
  if (Object.keys(nextClassValues).length === 0) delete nextOverrides[classSlug];
  else nextOverrides[classSlug] = nextClassValues;
  return nextOverrides;
}

/** A blank amount inherits the session default; exact zero remains an override. */
function ClassOverrideField({
  schoolClass,
  elementSlug,
  element,
  currency,
  classOverrides,
  onChange,
}: {
  schoolClass: SessionFinanceClassDto;
  elementSlug: string;
  element: FinanceElement;
  currency?: CurrencyCode;
  classOverrides: FinanceClassOverrides;
  onChange?: (classOverrides: FinanceClassOverrides) => void;
}) {
  const amountMinor = classOverrides[schoolClass.slug]?.[elementSlug];
  const value =
    currency && amountMinor !== undefined
      ? formatCurrencyMinorNumber(amountMinor, currency)
      : '';
  const inputId = `finance-${schoolClass.slug}-${elementSlug}`;
  const form = useForm({
    defaultValues: { amount: value },
    validators: {
      onSubmit: z.object({
        amount: z.string().superRefine((amount, context) => {
          if (amount === '') return;
          if (!currency) {
            context.addIssue({
              code: 'custom',
              message: 'Choose the session currency before setting amounts.',
            });
            return;
          }
          try {
            parseCurrencyDecimalToMinorNumber(amount, currency);
          } catch (error) {
            context.addIssue({
              code: 'custom',
              message:
                error instanceof Error
                  ? error.message
                  : 'Enter an exact amount.',
            });
          }
        }),
      }),
    },
    onSubmit: ({ value: submitted }) => {
      if (!onChange) return;
      const nextAmount =
        submitted.amount === '' || !currency
          ? undefined
          : parseCurrencyDecimalToMinorNumber(submitted.amount, currency);
      onChange(
        updateOverride(
          classOverrides,
          schoolClass.slug,
          elementSlug,
          nextAmount,
        ),
      );
    },
  });

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={onChange ? inputId : undefined} className="justify-start sm:sr-only">
        {element.name}<span className="sr-only"> for {schoolClass.label}</span>
      </Label>
      {onChange ? (
        <form.Field name="amount">
          {(field) => (
            <form onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
              <Input
                id={inputId}
                inputMode="decimal"
                disabled={!currency}
                value={field.state.value}
                placeholder={
                  !currency
                    ? 'Choose currency'
                    : element.defaultAmountMinor === undefined
                      ? 'Not set'
                      : `Default: ${formatCurrencyMinorNumber(element.defaultAmountMinor, currency)}`
                }
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={() => { field.handleBlur(); void form.handleSubmit(); }}
              />
              {field.state.meta.errors.map((error, index) => (
                <p key={`${String(error)}-${index}`} className="mt-1 text-xs text-destructive">
                  {typeof error === 'object' && error && 'message' in error
                    ? String(error.message)
                    : String(error)}
                </p>
              ))}
            </form>
          )}
        </form.Field>
      ) : (
        <span className="text-xs text-muted-foreground">
          {amountMinor === undefined
            ? 'Uses session default'
            : currency
              ? `${formatCurrencyMinorNumber(amountMinor, currency)} ${currency}`
              : 'Currency not configured'}
        </span>
      )}
    </div>
  );
}

function ClassOverrideHeaders({ elements, currency }: {
  elements: Array<[string, FinanceElement]>;
  currency?: CurrencyCode;
}) {
  return (
    <TableHeader role="rowgroup" className="hidden bg-muted/40 sm:table-header-group">
      <TableRow role="row">
        <TableHead scope="col" role="columnheader">Class</TableHead>
        {elements.map(([slug, element]) => (
          <TableHead key={slug} scope="col" role="columnheader" className="py-2 whitespace-normal">
            <span className="block">{element.name}</span>
            <span className="block text-[11px] font-normal text-muted-foreground">
              {element.defaultAmountMinor === undefined
                ? 'No default'
                : currency
                  ? `Default: ${formatCurrencyMinorNumber(element.defaultAmountMinor, currency)} ${currency}`
                  : 'Currency not configured'}
            </span>
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

export function ClassFinanceOverridesSection({
  financeConfig,
  classOverrides,
  classes,
  onChange,
}: ClassFinanceOverridesSectionProps) {
  const classElements = Object.entries(financeConfig?.elements ?? {}).filter(
    ([, element]) => element.scopes.includes('class'),
  );
  const sortedClasses = classes.toSorted((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true }),
  );
  const currency = financeConfig?.currency;

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Building2 aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-semibold">Class overrides</h3>
          <p className="text-xs text-muted-foreground">
            {currency ? `All amounts in ${currency}. ` : 'Choose a currency before editing amounts. '}
            Leave blank to use the session default; enter 0 for no charge.
          </p>
        </div>
      </div>

      {!financeConfig ? (
        <p className="text-sm text-muted-foreground">Create the finance schema before adding class overrides.</p>
      ) : classElements.length === 0 ? (
        <p className="text-sm text-muted-foreground">No fee elements currently allow class-level values.</p>
      ) : classes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add classes to the school before configuring class overrides.</p>
      ) : (
        <div className="min-w-0 overflow-hidden rounded-lg border">
          <Table role="table" aria-label="Class fee overrides" className="block sm:table">
            <ClassOverrideHeaders elements={classElements} currency={currency} />
            <TableBody role="rowgroup" className="block sm:table-row-group">
              {sortedClasses.map((schoolClass) => (
                <TableRow key={schoolClass.slug} role="row" className="grid gap-3 p-3 hover:bg-transparent sm:table-row sm:p-0 sm:hover:bg-muted/50">
                  <TableHead scope="row" role="rowheader" className="h-auto min-w-0 p-0 whitespace-normal sm:w-36 sm:p-2">
                    {schoolClass.label}
                  </TableHead>
                  {classElements.map(([elementSlug, element]) => {
                    const amountMinor = classOverrides[schoolClass.slug]?.[elementSlug];
                    return (
                      <TableCell key={elementSlug} role="cell" className="min-w-0 p-0 whitespace-normal sm:min-w-36 sm:p-2">
                        <ClassOverrideField
                          key={`${currency ?? 'none'}-${amountMinor ?? 'empty'}`}
                          schoolClass={schoolClass}
                          elementSlug={elementSlug}
                          element={element}
                          currency={currency}
                          classOverrides={classOverrides}
                          onChange={onChange}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
