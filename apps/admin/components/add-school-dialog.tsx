'use client';

import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import {
  SCHOOL_TIERS,
  schoolTierCatalogue,
  type SchoolTier,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { addSchoolInputSchema } from '@campuspilot/api/routers/system-admin/school/school.dto';
import { OptionSelect, type OptionSelectOption } from '@campuspilot/components/option-select';
import { Button } from '@campuspilot/ui/components/button';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
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
import { client, orpc } from '@/lib/orpc';
import { uploadSchoolLogo } from '@/lib/school-image';
import { BILLING_PERIOD_DAYS } from '@campuspilot/api/billing/billing.contract';
import { addDays, defaultTrialEndDay, endOfIstDay, istDay, trialEndDayProblem } from '@/lib/trial-dates';
import { NO_PLAN_CONSEQUENCE } from './school-plan-effect';

/**
 * The subscription choice: a tier, or none. Empty until the administrator
 * picks one, so the choice is never made for them.
 */
type SubscriptionChoice = SchoolTier | 'none' | '';

/**
 * The form's own shape: the subscription is a tier or "none", and the trial
 * is a switch with its tier and end day (a date input's `YYYY-MM-DD`, ending
 * at the last second of that IST day). A school with neither has no plan;
 * that is allowed and said plainly before it is created.
 */
const addSchoolFormSchema = addSchoolInputSchema
  .omit({ tier: true, trial: true })
  .extend({
    registrationNo: z.string(),
    logo: z.instanceof(File).nullable(),
    tier: z.union([z.enum([...SCHOOL_TIERS, 'none']), z.literal('')]).refine((tier) => tier !== '', { message: 'Choose a standing tier, or None (billed by period).' }),
    withTrial: z.boolean(),
    trialTier: z.enum(SCHOOL_TIERS),
    trialEndDay: z.string(),
  })
  .superRefine((value, context) => {
    const problem = value.withTrial ? trialEndDayProblem(value.trialEndDay) : null;
    if (problem) context.addIssue({ code: 'custom', message: problem, path: ['trialEndDay'] });
  });

type AddSchoolFormValues = z.input<typeof addSchoolFormSchema>;

const SUBSCRIPTION_OPTIONS: OptionSelectOption<SubscriptionChoice>[] = [
  { value: '', label: 'Choose a standing tier', disabled: true },
  ...SCHOOL_TIERS.map((tier) => ({ value: tier, label: schoolTierCatalogue[tier].label })),
  { value: 'none', label: 'None (billed by period)' },
];

const TRIAL_TIER_OPTIONS: OptionSelectOption<SchoolTier>[] = SCHOOL_TIERS.map((tier) => ({
  value: tier,
  label: schoolTierCatalogue[tier].label,
}));

/** What the picked subscription includes, or what having none means. */
function subscriptionDescription(tier: SubscriptionChoice) {
  if (tier === '') return 'A standing tier never lapses and is not billed (for contracts and demos). Most schools have none and are billed per 28-day period.';
  return tier === 'none'
    ? 'The school has a plan only while a trial or a paid period runs (Billing card, after creating it).'
    : `${schoolTierCatalogue[tier].description} It never lapses.`;
}

function FieldErrors({ errors }: { errors: unknown[] }) {
  return errors.map((error, index) => {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : undefined;
    return message ? <p key={`${message}-${index}`} className="text-xs text-destructive">{message}</p> : null;
  });
}

function defaultValues(): AddSchoolFormValues {
  return {
    slug: '',
    name: '',
    location: '',
    registrationNo: '',
    logo: null,
    tier: '',
    withTrial: false,
    trialTier: 'pro',
    trialEndDay: defaultTrialEndDay(),
  };
}

function useAddSchoolForm(onCreated: (schoolId: string) => void) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: defaultValues(),
    validators: { onSubmit: addSchoolFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      // The submit validator refuses an empty choice; this narrows the type.
      if (value.tier === '') return;
      try {
        const school = await client.systemAdmin.addSchool({
          slug: value.slug,
          name: value.name,
          location: value.location,
          registrationNo: value.registrationNo || undefined,
          tier: value.tier === 'none' ? null : value.tier,
          trial: value.withTrial ? { tier: value.trialTier, endsAt: endOfIstDay(value.trialEndDay) } : null,
        });
        if (value.logo) await uploadSchoolLogo(school.id, value.logo);
        await queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSchools.key() });
        form.reset(defaultValues());
        onCreated(school.id);
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to add the school.', fields: {} },
        });
      }
    },
  });
  return form;
}

type AddSchoolForm = ReturnType<typeof useAddSchoolForm>;

function TextField({ form, name, label, placeholder }: { form: AddSchoolForm; name: 'name' | 'slug' | 'location' | 'registrationNo'; label: string; placeholder?: string }) {
  return (
    <form.Field name={name}>
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor={field.name}>{label}</Label>
          <Input id={field.name} placeholder={placeholder} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
          <FieldErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function SubscriptionField({ form }: { form: AddSchoolForm }) {
  return (
    <form.Field name="tier">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor={field.name}>Standing tier</Label>
          <OptionSelect
            value={field.state.value}
            options={SUBSCRIPTION_OPTIONS}
            onValueChange={(tier) => field.handleChange(tier)}
            triggerProps={{ id: field.name, className: 'w-full', onBlur: field.handleBlur }}
          />
          <p className="text-xs text-muted-foreground">{subscriptionDescription(field.state.value)}</p>
          <FieldErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function TrialSwitchField({ form }: { form: AddSchoolForm }) {
  return (
    <form.Field name="withTrial">
      {(field) => (
        <div className="flex items-center gap-2">
          <Checkbox id={field.name} checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked === true)} />
          <Label htmlFor={field.name}>Start a trial</Label>
        </div>
      )}
    </form.Field>
  );
}

function TrialTierField({ form }: { form: AddSchoolForm }) {
  return (
    <form.Field name="trialTier">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor={field.name}>Trial tier</Label>
          <OptionSelect
            value={field.state.value}
            options={TRIAL_TIER_OPTIONS}
            onValueChange={(tier) => field.handleChange(tier)}
            triggerProps={{ id: field.name, className: 'w-full', onBlur: field.handleBlur }}
          />
        </div>
      )}
    </form.Field>
  );
}

/** The trial's end day, one 28-day period ahead by default, with a quick "+28 days". */
function TrialEndField({ form }: { form: AddSchoolForm }) {
  return (
    <form.Field name="trialEndDay">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor={field.name}>Trial ends on</Label>
          <div className="flex items-center gap-2">
            <Input id={field.name} type="date" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => field.handleChange(addDays(trialEndDayProblem(field.state.value) ? istDay(new Date()) : field.state.value, BILLING_PERIOD_DAYS))}
            >
              +28 days
            </Button>
          </div>
          <FieldErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

/** The trial switch, and its tier and end while it is on. */
function TrialFields({ form }: { form: AddSchoolForm }) {
  return (
    <div className="flex flex-col gap-3">
      <TrialSwitchField form={form} />
      <form.Subscribe selector={(state) => state.values.withTrial}>
        {(withTrial) =>
          withTrial ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <TrialTierField form={form} />
              <TrialEndField form={form} />
            </div>
          ) : null
        }
      </form.Subscribe>
    </div>
  );
}

/** Said while neither a subscription nor a trial is chosen: the school would have no plan. */
function NoPlanNotice({ form }: { form: AddSchoolForm }) {
  return (
    <form.Subscribe selector={(state) => state.values.tier === 'none' && !state.values.withTrial}>
      {(noPlan) =>
        noPlan ? (
          <p role="status" className="rounded-md border border-warning/50 bg-warning/10 p-3 text-xs text-foreground">
            Without a standing tier or a trial, this school has no plan. {NO_PLAN_CONSEQUENCE}
          </p>
        ) : null
      }
    </form.Subscribe>
  );
}

function LogoField({ form }: { form: AddSchoolForm }) {
  return (
    <form.Field name="logo">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor={field.name}>Logo</Label>
          <Input id={field.name} type="file" accept="image/jpeg,image/png,image/webp" onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.files?.[0] ?? null)} />
          <p className="text-xs text-muted-foreground">Large images are resized in your browser before upload. Maximum upload size: 5 MB.</p>
          <FieldErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function AddSchoolFooter({ form, onCancel }: { form: AddSchoolForm; onCancel: () => void }) {
  return (
    <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting, errors: state.errors })}>
      {({ canSubmit, isSubmitting, errors }) => (
        <>
          <FieldErrors errors={errors} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Adding school…' : 'Add school'}</Button>
          </DialogFooter>
        </>
      )}
    </form.Subscribe>
  );
}

export function AddSchoolDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const form = useAddSchoolForm((schoolId) => {
    onOpenChange(false);
    router.push(`/school/${schoolId}`);
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) form.reset(defaultValues());
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add school</DialogTitle>
          <DialogDescription>Create a school with a trial (or a standing tier), and optionally upload its logo.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <TextField form={form} name="name" label="Name" />
          <TextField form={form} name="slug" label="Slug" placeholder="green-valley-school" />
          <TextField form={form} name="location" label="Location" />
          <TextField form={form} name="registrationNo" label="Registration number" />
          <SubscriptionField form={form} />
          <TrialFields form={form} />
          <NoPlanNotice form={form} />
          <LogoField form={form} />
          <AddSchoolFooter form={form} onCancel={() => handleOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
