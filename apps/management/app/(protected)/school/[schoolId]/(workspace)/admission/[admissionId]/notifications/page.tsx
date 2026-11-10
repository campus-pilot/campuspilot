import { NotificationDeliveryLogSection } from '@/components/notifications/notification-delivery-log';

export default async function AdmissionNotificationsPage({ params }: { params: Promise<{ schoolId: string; admissionId: string }> }) {
  const { schoolId, admissionId } = await params;
  return <NotificationDeliveryLogSection schoolId={schoolId} scope={{ kind: 'admission', admissionId }} />;
}
