'use client';

import { Checkbox } from '@campuspilot/ui/components/checkbox';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { FieldRow, StepIntro } from './field-bits';
import type { SetupFormApi } from './setup-form';

type PrincipalField = 'draft.people.principal.name' | 'draft.people.principal.phone' | 'draft.people.principal.email';

function PrincipalInput({ form, name, label, hint, type = 'text' }: { form: SetupFormApi; name: PrincipalField; label: string; hint?: string; type?: string }) {
  return (
    <form.Field name={name}>
      {(field) => (
        <FieldRow id={field.name} label={label} hint={hint} errors={field.state.meta.errors}>
          <Input id={field.name} type={type} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
        </FieldRow>
      )}
    </form.Field>
  );
}

/**
 * The last decision: who gets into the school. The admin running the setup
 * can join as a manager; the form's contact becomes principal and owner,
 * found by phone (else email) or created without a password, which is
 * issued once the school exists.
 */
export function PeopleStep({ form }: { form: SetupFormApi }) {
  return (
    <div className="flex flex-col gap-5">
      <StepIntro title="People" description="Who gets access to the school when it is created." />
      <form.Field name="draft.people.addMeAsManager">
        {(field) => (
          <div className="flex items-start gap-2 rounded-lg border p-3">
            <Checkbox id={field.name} checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked === true)} />
            <div className="flex flex-col gap-1">
              <Label htmlFor={field.name}>Add me as manager</Label>
              <p className="text-xs text-muted-foreground">You join the school with the manager role, to finish its setup from the management app.</p>
            </div>
          </div>
        )}
      </form.Field>
      <div className="flex flex-col gap-4">
        <span className="text-sm font-medium">Principal and owner</span>
        <PrincipalInput form={form} name="draft.people.principal.name" label="Name" hint="Optional; they can change it after signing in." />
        <div className="grid gap-4 sm:grid-cols-2">
          <PrincipalInput form={form} name="draft.people.principal.phone" label="Phone number" type="tel" hint="Signs in with this number. Indian numbers need no +91." />
          <PrincipalInput form={form} name="draft.people.principal.email" label="Email (optional)" type="email" hint="A Gmail address lets them use Continue with Google." />
        </div>
        <p className="text-xs text-muted-foreground">
          An existing CampusPilot account with this phone number (or email) is used as it is. Otherwise a new account is created, and you issue its password once the school exists.
        </p>
      </div>
    </div>
  );
}
