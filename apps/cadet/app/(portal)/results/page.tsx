import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ResultsScreen } from '@/components/results/results-screen';
import { ScreenLoading } from '@/components/screen';

export const metadata: Metadata = { title: 'Results' };

/** `?class=` picks an earlier class record; without it the server's current class. */
export default function ResultsPage() {
  return (
    <Suspense fallback={<ScreenLoading blocks={2} />}>
      <ResultsScreen />
    </Suspense>
  );
}
