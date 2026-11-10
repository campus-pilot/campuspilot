import type { Metadata } from 'next';
import { DataMigrationsView } from '@/components/data-migrations/data-migrations-view';

export const metadata: Metadata = {
  title: 'Data migrations | CampusPilot Admin',
};

export default function DataMigrationsPage() {
  return <DataMigrationsView />;
}
