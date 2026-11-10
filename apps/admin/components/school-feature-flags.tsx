'use client';

import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  schoolFeatureCatalogue,
  schoolFeatureEntries,
  type SchoolFeatureConfig,
  type SchoolFeatureEntry,
  type SchoolFeatureKey,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campuspilot/ui/components/card';
import { Label } from '@campuspilot/ui/components/label';
import { Switch } from '@campuspilot/ui/components/switch';
import { toast } from '@campuspilot/ui/lib/toast';
import { LoaderCircle } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';

/** The features whose catalogue config is not `z.null()`, i.e. that have settings to edit. */
type FeaturesWithSettings = {
  [K in SchoolFeatureKey]: SchoolFeatureConfig<K> extends null ? never : K;
}[SchoolFeatureKey];

/**
 * Compile-time guard. No feature has settings today, so each card is only an
 * on/off switch and the stored config is sent back unchanged. As soon as a
 * catalogue entry declares a config schema this line stops compiling: add
 * that feature's config control to its card (a TanStack Form field validated
 * with the catalogue schema; see docs/feature-flags.md) and then update or
 * remove this guard.
 */
const EVERY_FEATURE_IS_SWITCH_ONLY: [FeaturesWithSettings] extends [never] ? true : never = true;
void EVERY_FEATURE_IS_SWITCH_ONLY;

/**
 * What switching a feature off does, shown before the change is saved.
 * Exhaustive, so every new feature states its consequence.
 */
const DISABLE_WARNINGS: Record<SchoolFeatureKey, string> = {
  cadet:
    'Students of this school can no longer sign in or use the Cadet Portal, including connected AI apps. Staff can no longer issue portal passwords, release exam results to the portal, or save or publish a notice addressed to students. Logins, released results and notices are kept.',
  notices:
    'Staff of this school can no longer open, write or publish notices, or edit the Notice template. Students no longer see notices in the Cadet Portal, and notice notifications that have not gone out yet are not sent. Existing notices are kept.',
};

const featureFormSchema = z.object({ enabled: z.boolean() });

function formError(error: unknown): string {
  return typeof error === 'object' && error !== null && 'form' in error
    ? String(error.form)
    : String(error);
}

function FeatureStatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? 'default' : 'outline'}>
      {enabled ? 'Enabled' : 'Disabled'}
    </Badge>
  );
}

/**
 * Saves one feature. The form holds `enabled`; the stored config is sent
 * back unchanged, because enabling or disabling never clears it (and no
 * feature has editable settings yet, see the guard above).
 *
 * `entry` is the feature's key and its own stored state as one discriminated
 * value (`SchoolFeatureEntry`), so the update is built by spreading it and no
 * cast can pair one feature's config with another feature's key.
 */
function useFeatureFlagForm(schoolId: string, entry: SchoolFeatureEntry) {
  const { feature } = entry;
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { enabled: entry.enabled },
    validators: { onSubmit: featureFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const saved = await client.systemAdmin.updateSchoolFeatureFlag({
          id: schoolId,
          ...entry,
          enabled: value.enabled,
        });
        queryClient.setQueryData(
          orpc.systemAdmin.getSchoolFeatureFlags.queryKey({ input: { id: schoolId } }),
          saved,
        );
        const label = schoolFeatureCatalogue[feature].label;
        toast.success(`${label} ${value.enabled ? 'enabled' : 'disabled'}.`);
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form: error instanceof Error ? error.message : 'Unable to save the feature.',
            fields: {},
          },
        });
      }
    },
  });
  return form;
}

type FeatureFlagFormProps = {
  schoolId: string;
  entry: SchoolFeatureEntry;
};

function FeatureFlagForm({ schoolId, entry }: FeatureFlagFormProps) {
  const { feature } = entry;
  const form = useFeatureFlagForm(schoolId, entry);
  const switchId = `feature-${feature}-enabled`;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="enabled">
        {(field) => (
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={switchId}>Enabled for this school</Label>
            <Switch
              id={switchId}
              checked={field.state.value}
              onCheckedChange={(checked) => field.handleChange(checked)}
            />
          </div>
        )}
      </form.Field>
      <form.Subscribe
        selector={(formState) => ({
          enabled: formState.values.enabled,
          isDirty: formState.isDirty,
          isSubmitting: formState.isSubmitting,
          errors: formState.errors,
        })}
      >
        {({ enabled, isDirty, isSubmitting, errors }) => (
          <div className="flex flex-col gap-3">
            {entry.enabled && !enabled ? (
              <p className="text-xs text-destructive" role="alert">
                {DISABLE_WARNINGS[feature]}
              </p>
            ) : null}
            {errors.map((error) => (
              <p key={formError(error)} className="text-xs text-destructive">
                {formError(error)}
              </p>
            ))}
            <div className="flex justify-end">
              <Button type="submit" disabled={!isDirty || isSubmitting}>
                {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

function FeatureFlagCard({ schoolId, entry }: FeatureFlagFormProps) {
  const { label, description } = schoolFeatureCatalogue[entry.feature];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {label}
          <FeatureStatusBadge enabled={entry.enabled} />
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Keyed by the saved state so the form restarts from what was stored. */}
        <FeatureFlagForm key={JSON.stringify(entry)} schoolId={schoolId} entry={entry} />
      </CardContent>
    </Card>
  );
}

function FeatureFlagsHeading() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Feature flags</h1>
      <p className="text-sm text-muted-foreground">
        Choose which CampusPilot features this school has. Changes apply at once; the school&apos;s staff cannot
        change them.
      </p>
    </div>
  );
}

/** Platform feature flags of one school: a card per catalogue feature. */
export function SchoolFeatureFlags({ schoolId }: { schoolId: string }) {
  const flagsQuery = useQuery(
    orpc.systemAdmin.getSchoolFeatureFlags.queryOptions({ input: { id: schoolId } }),
  );

  if (flagsQuery.isPending) {
    return (
      <section className="mx-auto flex w-full max-w-4xl animate-pulse flex-col gap-5">
        <div className="h-14 w-52 rounded-lg bg-muted" />
        <div className="h-36 rounded-lg bg-muted" />
        <div className="h-36 rounded-lg bg-muted" />
      </section>
    );
  }

  if (flagsQuery.isError) {
    return (
      <Card className="mx-auto w-full max-w-4xl">
        <CardHeader>
          <CardTitle>Unable to load feature flags</CardTitle>
          <CardDescription>
            {flagsQuery.error instanceof Error ? flagsQuery.error.message : 'Try refreshing the page.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { features } = flagsQuery.data;
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <FeatureFlagsHeading />
      {schoolFeatureEntries(features).map((entry) => (
        <FeatureFlagCard key={entry.feature} schoolId={schoolId} entry={entry} />
      ))}
    </section>
  );
}
