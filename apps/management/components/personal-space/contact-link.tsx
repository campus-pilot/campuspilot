'use client';

import type { ReactNode } from 'react';
import { env } from '@campuspilot/env/management.client';
import { requestErrorMessage } from '@/components/question-paper/question-paper-model';
import { contactHrefOf, personalWriteRefusalOf } from './personal-space-model';

/** The website's contact page, in a new tab (docs/personal-space.md, "Trial end"). */
export function ContactLink({ children }: { children: ReactNode }) {
  return (
    <a href={contactHrefOf(env.NEXT_PUBLIC_WEBSITE_URL)} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">
      {children}
    </a>
  );
}

/**
 * Why an action in a personal space failed, for the line beside it: a
 * read-only refusal (the trial ended, or the space is suspended) in the
 * space's own words with the contact link (`personalWriteRefusalOf`), any
 * other error as the server worded it, or `fallback`.
 */
export function PersonalSpaceErrorText({ error, fallback }: { error: unknown; fallback: string }) {
  const refusal = personalWriteRefusalOf(error);
  if (!refusal) return <>{requestErrorMessage(error, fallback)}</>;
  return (
    <>
      {refusal.message} <ContactLink>{refusal.contact}</ContactLink>.
    </>
  );
}
