import type { Metadata } from 'next';
import { OAuthClientsTable } from '@/components/oauth-clients-table';

export const metadata: Metadata = {
  title: 'OAuth clients | CampusPilot Admin',
};

export default function OAuthClientsPage() {
  return <OAuthClientsTable />;
}
