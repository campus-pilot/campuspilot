'use client';

import { Badge } from '@campuspilot/ui/components/badge';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
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

function ClassOverrideFields({
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
    <article className="flex flex-col gap-3 rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">{schoolClass.label}</h4>
        <Badge variant="outline" className="font-mono text-[10px]">
          {schoolClass.slug}
        </Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {elements.map(([elementSlug, element]) => {
          const value = classOverrides[schoolClass.slug]?.[elementSlug];
          const inputId = `finance-${schoolClass.slug}-${elementSlug}`;
          return (
            <Label key={elementSlug} htmlFor={inputId} className="flex flex-col gap-1.5">
              <span>{element.name}</span>
              {onChange ? (
                <Input
                  id={inputId}
                  type="number"
                  min={0}
                  step="any"
                  value={value ?? ''}
                  placeholder={
                    element.defaultValue === undefined
                      ? `Amount in ${currency}`
                      : `Default ${element.defaultValue} ${currency}`
                  }
                  onChange={(event) => {
                    const amount =
                      event.target.value === ''
                        ? undefined
                        : Number(event.target.value);
                    onChange(
                      updateOverride(
                        classOverrides,
                        schoolClass.slug,
                        elementSlug,
                        amount,
                      ),
                    );
                  }}
                />
              ) : (
                <span className="text-sm text-muted-foreground">
                  {value === undefined ? 'Uses session default' : `${value} ${currency}`}
                </span>
              )}
            </Label>
          );
        })}
      </div>
    </article>
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

  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 size-4 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Class overrides</h3>
          <p className="text-xs text-muted-foreground">
            Set amounts only where a class differs from the session-level fee
            defaults. Empty values continue to inherit the default.
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
        <div className="grid gap-3 lg:grid-cols-2">
          {classes.map((schoolClass) => (
            <ClassOverrideFields
              key={schoolClass.slug}
              schoolClass={schoolClass}
              elements={classElements}
              currency={financeConfig.currency}
              classOverrides={classOverrides}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </section>
  );
}
