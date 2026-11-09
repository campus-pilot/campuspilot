import { Suspense } from 'react';
import type { Metadata } from 'next';
import { GrowthScreen } from '@/components/growth/growth-screen';
import { ScreenLoading } from '@/components/screen';

export const metadata: Metadata = { title: 'Growth' };

/** `?class=` picks the class record; without it the server picks the current class. */
export default function GrowthPage() {
  return (
    <Suspense fallback={<ScreenLoading blocks={3} />}>
      <GrowthScreen />
    </Suspense>
  );
}
