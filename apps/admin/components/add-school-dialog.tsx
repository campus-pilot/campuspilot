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

/**
 * The form's tier is empty until the administrator picks one: a new school
 * has no default tier, so the choice is never made for them.
 */
const addSchoolFormSchema = addSchoolInputSchema.extend({
  registrationNo: z.string(),
  logo: z.instanceof(File).nullable(),
  tier: z.union([z.enum(SCHOOL_TIERS), z.literal('')]).refine((tier) => tier !== '', { message: 'Choose a tier.' }),
});

const TIER_OPTIONS: OptionSelectOption<SchoolTier | ''>[] = [
  { value: '', label: 'Choose a tier', disabled: true },
  ...SCHOOL_TIERS.map((tier) => ({ value: tier, label: schoolTierCatalogue[tier].label })),
];

/** What the picked tier includes, or a prompt to pick one. */
function tierDescription(tier: SchoolTier | '') {
  return tier === '' ? 'The tier decides which features the school has. It can be changed later.' : schoolTierCatalogue[tier].description;
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

export function AddSchoolDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: {
      slug: '',
      name: '',
      location: '',
      registrationNo: '',
      logo: null as File | null,
      tier: '' as SchoolTier | '',
    },
    validators: { onSubmit: addSchoolFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      // The submit validator refuses an empty tier; this narrows the type.
      if (value.tier === '') return;
      try {
        const school = await client.systemAdmin.addSchool({
          slug: value.slug,
          name: value.name,
          location: value.location,
          registrationNo: value.registrationNo || undefined,
          tier: value.tier,
        });
        if (value.logo) await uploadSchoolLogo(school.id, value.logo);
        await queryClient.invalidateQueries({
          queryKey: orpc.systemAdmin.listSchools.queryKey({ input: {} }),
        });
        form.reset();
        onOpenChange(false);
        router.push(`/school/${school.id}`);
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form: error instanceof Error ? error.message : 'Unable to add the school.',
            fields: {},
          },
        });
      }
    },
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) form.reset();
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add school</DialogTitle>
          <DialogDescription>Create a school on a tier and optionally upload its logo.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="name">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor={field.name}>Name</Label>
                <Input id={field.name} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Field name="slug">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor={field.name}>Slug</Label>
                <Input id={field.name} placeholder="green-valley-school" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Field name="location">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor={field.name}>Location</Label>
                <Input id={field.name} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Field name="registrationNo">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor={field.name}>Registration number</Label>
                <Input id={field.name} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Field name="tier">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor={field.name}>Tier</Label>
                <OptionSelect
                  value={field.state.value}
                  options={TIER_OPTIONS}
                  onValueChange={(tier) => field.handleChange(tier)}
                  triggerProps={{ id: field.name, className: 'w-full', onBlur: field.handleBlur }}
                />
                <p className="text-xs text-muted-foreground">{tierDescription(field.state.value)}</p>
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
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
          <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting, errors: state.errors })}>
            {({ canSubmit, isSubmitting, errors }) => (
              <>
                <FieldErrors errors={errors} />
                <DialogFooter>
                  <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => handleOpenChange(false)}>Cancel</Button>
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Adding school…' : 'Add school'}</Button>
                </DialogFooter>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}
