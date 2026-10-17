'use client';

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
import type {
  FinanceClassOverrides,
  FinanceElement,
  FinanceSchemaConfig,
  SessionFinanceClassDto,
} from './types';

export interface ClassFinanceOverridesSectionProps {
  financeConfig: FinanceSchemaConfig | null;
  classOverrides: FinanceClassOverrides;
  classes: SessionFinanceClassDto[];
  onChange?: (classOverrides: FinanceClassOverrides) => void;
}

/**
 * Stores only explicit overrides. Clearing an input removes that fee element,
 * allowing the session-level default to retain precedence automatically.
 */
function updateOverride(
  classOverrides: FinanceClassOverrides,
  classSlug: string,
  elementSlug: string,
  amount: number | undefined,
) {
  const nextClassValues = { ...classOverrides[classSlug] };
  if (amount === undefined) delete nextClassValues[elementSlug];
  else nextClassValues[elementSlug] = amount;

  const nextOverrides = { ...classOverrides };
  if (Object.keys(nextClassValues).length === 0) delete nextOverrides[classSlug];
  else nextOverrides[classSlug] = nextClassValues;
  return nextOverrides;
}

/** The blank input inherits the default; an explicit zero remains an override. */
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
  currency: string;
  classOverrides: FinanceClassOverrides;
  onChange?: (classOverrides: FinanceClassOverrides) => void;
}) {
  const value = classOverrides[schoolClass.slug]?.[elementSlug];
  const inputId = `finance-${schoolClass.slug}-${elementSlug}`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label
        htmlFor={onChange ? inputId : undefined}
        className="justify-start sm:sr-only"
      >
        {element.name}
        <span className="sr-only"> for {schoolClass.label}</span>
      </Label>
      {onChange ? (
        <Input
          id={inputId}
          type="number"
          min={0}
          step="any"
          value={value ?? ''}
          placeholder={
            element.defaultValue === undefined
              ? 'Not set'
              : `Default: ${element.defaultValue}`
          }
          onChange={(event) => {
            const amount =
              event.target.value === '' ? undefined : Number(event.target.value);
            onChange(
              updateOverride(classOverrides, schoolClass.slug, elementSlug, amount),
            );
          }}
        />
      ) : (
        <span className="text-xs text-muted-foreground">
          {value === undefined ? 'Uses session default' : `${value} ${currency}`}
        </span>
      )}
    </div>
  );
}

/** Explicit table roles preserve semantics when rows become stacked mobile grids. */
function ClassOverrideRow({
  schoolClass,
  elements,
  currency,
  classOverrides,
  onChange,
}: {
  schoolClass: SessionFinanceClassDto;
  elements: Array<[string, FinanceElement]>;
  currency: string;
  classOverrides: FinanceClassOverrides;
  onChange?: (classOverrides: FinanceClassOverrides) => void;
}) {
  return (
    <TableRow
      role="row"
      className="grid gap-3 p-3 hover:bg-transparent sm:table-row sm:p-0 sm:hover:bg-muted/50"
    >
      <TableHead
        scope="row"
        role="rowheader"
        className="h-auto min-w-0 p-0 whitespace-normal sm:w-36 sm:p-2"
      >
        {schoolClass.label}
      </TableHead>
      {elements.map(([elementSlug, element]) => (
        <TableCell
          key={elementSlug}
          role="cell"
          className="min-w-0 p-0 whitespace-normal sm:min-w-36 sm:p-2"
        >
          <ClassOverrideField
            schoolClass={schoolClass}
            elementSlug={elementSlug}
            element={element}
            currency={currency}
            classOverrides={classOverrides}
            onChange={onChange}
          />
        </TableCell>
      ))}
    </TableRow>
  );
}

function ClassOverrideHeaders({
  elements,
  currency,
}: {
  elements: Array<[string, FinanceElement]>;
  currency: string;
}) {
  return (
    <TableHeader
      role="rowgroup"
      className="hidden bg-muted/40 sm:table-header-group"
    >
      <TableRow role="row">
        <TableHead scope="col" role="columnheader">
          Class
        </TableHead>
        {elements.map(([slug, element]) => (
          <TableHead
            key={slug}
            scope="col"
            role="columnheader"
            className="py-2 whitespace-normal"
          >
            <span className="block">{element.name}</span>
            <span className="block text-[11px] font-normal text-muted-foreground">
              {element.defaultValue === undefined
                ? 'No default'
                : `Default: ${element.defaultValue} ${currency}`}
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

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Building2
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-semibold">Class overrides</h3>
          <p className="text-xs text-muted-foreground">
            All amounts in {financeConfig?.currency ?? 'the session currency'}.
            Leave blank to use the session default; enter 0 for no charge.
          </p>
        </div>
      </div>

      {!financeConfig ? (
        <p className="text-sm text-muted-foreground">
          Create the finance schema before adding class overrides.
        </p>
      ) : classElements.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No fee elements currently allow class-level values.
        </p>
      ) : classes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add classes to the school before configuring class overrides.
        </p>
      ) : (
        <div className="min-w-0 overflow-hidden rounded-lg border">
          <Table
            role="table"
            aria-label="Class fee overrides"
            className="block sm:table"
          >
            <ClassOverrideHeaders
              elements={classElements}
              currency={financeConfig.currency}
            />
            <TableBody role="rowgroup" className="block sm:table-row-group">
              {sortedClasses.map((schoolClass) => (
                <ClassOverrideRow
                  key={schoolClass.slug}
                  schoolClass={schoolClass}
                  elements={classElements}
                  currency={financeConfig.currency}
                  classOverrides={classOverrides}
                  onChange={onChange}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
