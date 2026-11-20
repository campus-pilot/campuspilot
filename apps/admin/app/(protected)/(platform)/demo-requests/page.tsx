import type { Metadata } from 'next';
import { LeadsTable } from '@/components/leads/leads-table';

export const metadata: Metadata = {
  title: 'Demo Requests | CampusPilot Admin',
};

export default function DemoRequestsPage() {
  return <LeadsTable />;
}
