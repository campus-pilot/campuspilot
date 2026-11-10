import type { Metadata } from 'next';
import { TimetablesScreen } from '@/components/timetables/timetables-screen';

export const metadata: Metadata = { title: 'Timetables' };

export default function TimetablesPage() {
  return <TimetablesScreen />;
}
