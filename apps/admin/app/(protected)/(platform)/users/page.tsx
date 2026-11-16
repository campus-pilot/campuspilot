import type { Metadata } from 'next';
import { UsersTable } from '@/components/users/users-table';

export const metadata: Metadata = {
  title: 'Users | CampusPilot Admin',
};

export default function UsersPage() {
  return <UsersTable />;
}
