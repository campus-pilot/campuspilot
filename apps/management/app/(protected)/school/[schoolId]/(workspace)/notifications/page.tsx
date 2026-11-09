import { ManagementNotificationInbox } from '@/components/notifications/management-notifications';

/** The signed-in staff member's own notifications in this school; no permission needed. */
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4">
      <h1 className="text-lg font-semibold">Notifications</h1>
      <ManagementNotificationInbox schoolId={schoolId} />
    </div>
  );
}
