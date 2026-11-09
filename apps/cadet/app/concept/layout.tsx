import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ConceptShell } from '@/components/concept/concept-shell';

export const metadata: Metadata = { title: 'Concept', robots: { index: false } };

/** UX concept only: every screen below renders fictional data and calls no API. */
export default function ConceptLayout({ children }: { children: ReactNode }) {
  return <ConceptShell>{children}</ConceptShell>;
}
