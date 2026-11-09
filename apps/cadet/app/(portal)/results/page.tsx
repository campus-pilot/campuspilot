import type { Metadata } from 'next';
import { ResultsScreen } from '@/components/results/results-screen';

export const metadata: Metadata = { title: 'Results' };

/** The server's current class; earlier classes live at `/results/class/{recordId}`. */
export default function ResultsPage() {
  return <ResultsScreen />;
}
