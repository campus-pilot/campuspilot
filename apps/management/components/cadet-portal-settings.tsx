'use client';

import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { CadetPortalSettingsDto } from '@campuspilot/api/routers/school/cadet-settings/cadet-settings.dto';
import { CADET_CLASS_AVERAGE_MIN_STUDENTS } from '@campuspilot/api/routers/cadet/cadet.dto';
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
import { client, orpc } from '@/lib/orpc';
import { RequirePermissions } from './require-permissions';

const cadetSettingsSchema = z.object({ showClassAverages: z.boolean() });

/** What the Cadet Portal shares with students beyond their own records. */
export function CadetPortalSettings({ schoolId }: { schoolId: string }) {
  const query = useQuery(orpc.school.getCadetPortalSettings.queryOptions({ input: { schoolId } }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cadet Portal</CardTitle>
        <CardDescription>
          Students only ever see their own records. Results appear after you release an examination.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
        ) : query.isError ? (
          <p className="text-sm text-destructive">{query.error.message}</p>
        ) : (
          <RequirePermissions
            permissions={{ action: SCHOOL_ACTIONS.UPDATE_DETAILS, resource: { kind: 'school', schoolId } }}
            fallback={<ClassAveragesPreview settings={query.data} />}
          >
            <CadetPortalSettingsForm key={String(query.data.showClassAverages)} settings={query.data} />
          </RequirePermissions>
        )}
      </CardContent>
    </Card>
  );
}

function ClassAveragesPreview({ settings }: { settings: CadetPortalSettingsDto }) {
  return (
    <p className="text-sm">
      Class averages are {settings.showClassAverages ? 'shown' : 'hidden'} in the Cadet Portal.
    </p>
  );
}

function CadetPortalSettingsForm({ settings }: { settings: CadetPortalSettingsDto }) {
  const cache = useQueryClient();
  const form = useForm({
    defaultValues: { showClassAverages: settings.showClassAverages },
    validators: { onSubmit: cadetSettingsSchema },
    onSubmit: async ({ value }) => {
      try {
        const saved = await client.school.updateCadetPortalSettings({ schoolId: settings.schoolId, ...value });
        cache.setQueryData(orpc.school.getCadetPortalSettings.queryKey({ input: { schoolId: settings.schoolId } }), saved);
        form.reset({ showClassAverages: saved.showClassAverages });
        toast.success('Cadet Portal settings saved.');
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to save the settings.', fields: {} },
        });
      }
    },
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="showClassAverages">
        {(field) => (
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="cadet-show-class-averages">Show class averages</Label>
              <p className="text-xs text-muted-foreground">
                Students see their class&apos;s average next to their own released results and growth. An average is
                shown only when at least {CADET_CLASS_AVERAGE_MIN_STUDENTS} students have results, so a small class
                cannot reveal a classmate&apos;s marks. Ranks are never shown.
              </p>
            </div>
            <Switch
              id="cadet-show-class-averages"
              checked={field.state.value}
              onCheckedChange={(checked) => field.handleChange(checked)}
            />
          </div>
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) => ({ isDirty: state.isDirty, isSubmitting: state.isSubmitting, errors: state.errors })}
      >
        {({ isDirty, isSubmitting, errors }) => (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-end">
            {errors.map((error) => (
              <p key={String(error)} className="text-xs text-destructive">
                {typeof error === 'object' && error && 'form' in error ? String(error.form) : String(error)}
              </p>
            ))}
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
