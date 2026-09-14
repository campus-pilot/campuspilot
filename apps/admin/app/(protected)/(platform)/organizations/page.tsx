import type { Metadata } from 'next';
import { OrganizationsTable } from '@/components/organizations-table';

export const metadata: Metadata = {
  title: 'Organizations | CampusPilot Admin',
};

export default function OrganizationsPage() {
  return <OrganizationsTable />;
}
