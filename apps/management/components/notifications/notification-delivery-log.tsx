'use client';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { ExamPager, ReadError } from '@campuspilot/components/exam/exam-controls';
import { NotificationDeliveryLog, type DeliveryLogItem } from '@campuspilot/components/notifications';
import { Label } from '@campuspilot/ui/components/label';
import { Switch } from '@campuspilot/ui/components/switch';
import { toast } from '@campuspilot/ui/lib/toast';
import { z } from 'zod';

import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';

/** Which notifications a log shows (the API's scope, one per section). */
export type DeliveryLogScope =
  | { kind: 'admission'; admissionId: string }
  | { kind: 'bill_run'; billRunId: string }
  | { kind: 'exam'; sessionId: string; examSlug: string }
  | { kind: 'notice'; noticeId: string };

const PAGE_SIZE = 20;
const viewSchema = z.object({ page: z.number().int().positive(), onlyFailed: z.boolean() });

/**
 * The delivery log section for one admission, billing run, examination or notice
 * (Phase 7): rendered only for staff with `READ_NOTIFICATION_LOG`; "Resend"
 * on failed copies only with `SEND_NOTIFICATIONS`.
 */
export function NotificationDeliveryLogSection({ schoolId, scope, title = 'Notification deliveries' }: { schoolId: string; scope: DeliveryLogScope; title?: string }) {
  return (
    <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_NOTIFICATION_LOG, resource: { kind: 'school', schoolId } }}>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <DeliveryLogData schoolId={schoolId} scope={scope} />
      </section>
    </RequirePermissions>
  );
}

function useResend(schoolId: string) {
  const cache = useQueryClient();
  const canResend = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: { permissions: [{ action: SCHOOL_ACTIONS.SEND_NOTIFICATIONS, resource: { kind: 'school', schoolId } }] },
    }),
  );
  const mutation = useMutation({
    mutationFn: (deliveryId: string) => client.school.resendNotificationDelivery({ schoolId, deliveryId }),
    onSuccess: async () => {
      toast.success('Resend queued.');
      await cache.invalidateQueries({ queryKey: orpc.school.listNotificationDeliveries.key() });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The delivery could not be resent.'),
  });
  return { canResend: canResend.data?.results[0] === true, mutation };
}

function DeliveryLogData({ schoolId, scope }: { schoolId: string; scope: DeliveryLogScope }) {
  const view = useForm({ defaultValues: { page: 1, onlyFailed: false }, validators: { onChange: viewSchema } });
  const resend = useResend(schoolId);
  return (
    <view.Subscribe selector={(state) => state.values}>
      {({ page, onlyFailed }) => (
        <div className="flex flex-col gap-3">
          <view.Field name="onlyFailed">
            {(field) => (
              <div className="flex items-center gap-2">
                <Switch id={`${field.name}-${scope.kind}`} checked={field.state.value} onCheckedChange={(checked) => { field.handleChange(checked); view.setFieldValue('page', 1); }} />
                <Label htmlFor={`${field.name}-${scope.kind}`}>Only failed</Label>
              </div>
            )}
          </view.Field>
          <DeliveryLogPage
            schoolId={schoolId}
            scope={scope}
            page={page}
            onlyFailed={onlyFailed}
            onPage={(next) => view.setFieldValue('page', next)}
            canResend={resend.canResend}
            resendingDeliveryId={resend.mutation.isPending ? (resend.mutation.variables ?? null) : null}
            onResend={(deliveryId) => resend.mutation.mutate(deliveryId)}
          />
        </div>
      )}
    </view.Subscribe>
  );
}

function DeliveryLogPage(props: {
  schoolId: string;
  scope: DeliveryLogScope;
  page: number;
  onlyFailed: boolean;
  onPage: (page: number) => void;
  canResend: boolean;
  resendingDeliveryId: string | null;
  onResend: (deliveryId: string) => void;
}) {
  const query = useQuery(
    orpc.school.listNotificationDeliveries.queryOptions({
      input: { schoolId: props.schoolId, scope: props.scope, onlyFailed: props.onlyFailed, page: props.page, limit: PAGE_SIZE },
    }),
  );
  if (query.isPending) return <p className="text-sm text-muted-foreground">Loading deliveries…</p>;
  if (query.isError) return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <>
      <NotificationDeliveryLog
        items={query.data.items as DeliveryLogItem[]}
        canResend={props.canResend}
        resendingDeliveryId={props.resendingDeliveryId}
        onResend={props.onResend}
        emptyMessage={props.onlyFailed ? 'No failed deliveries.' : 'No notifications yet.'}
      />
      {query.data.pagination.totalPages > 1 ? (
        <ExamPager page={props.page} pages={query.data.pagination.totalPages} total={query.data.pagination.totalItems} onPage={props.onPage} />
      ) : null}
    </>
  );
}
