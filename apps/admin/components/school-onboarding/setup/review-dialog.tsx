'use client';

import type { ReactNode } from 'react';
import {
  resolveSchoolFeatureActivity,
  resolveSchoolFeatureSwitches,
  schoolFeatureCatalogue,
  schoolTierCatalogue,
  SCHOOL_FEATURE_KEYS,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { SchoolSetupDraft } from '@campuspilot/api/school-setup/school-setup.contract';
import { BILLING_PERIOD_DAYS } from '@campuspilot/api/billing/billing.contract';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { plannedTier } from './plan-tier';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="flex flex-col gap-1 text-sm">{children}</dl>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

function PlanFacts({ draft }: { draft: SchoolSetupDraft }) {
  const { standingTier, trial } = draft.plan;
  const tier = plannedTier(draft.plan);
  const active = resolveSchoolFeatureActivity(resolveSchoolFeatureSwitches(tier, draft.features.adjustments));
  const features = SCHOOL_FEATURE_KEYS.filter((key) => active[key]).map((key) => schoolFeatureCatalogue[key].label);
  return (
    <Section title="Plan">
      <Fact label="Standing tier" value={standingTier ? schoolTierCatalogue[standingTier].label : 'None'} />
      <Fact label="Trial" value={trial.enabled ? `${schoolTierCatalogue[trial.tier].label}, ${trial.periods * BILLING_PERIOD_DAYS} days from now` : 'None'} />
      <Fact label="Active features" value={features.length ? features.join(', ') : 'None'} />
      {active.assistant ? <Fact label="Assistant limit" value={draft.features.assistantMonthlyLimitUsd ? `${draft.features.assistantMonthlyLimitUsd} USD a month` : 'No limit'} /> : null}
    </Section>
  );
}

function ClassesTable({ classes }: { classes: SchoolSetupDraft['classes'] }) {
  return (
    <Section title={`Classes (${classes.length})`}>
      {classes.map((entry) => (
        <Fact key={entry.name} label={entry.name} value={`Sections ${entry.sections.join(', ')} · ${entry.subjects.join(', ')}`} />
      ))}
    </Section>
  );
}

/** Everything the setup will create, read from the draft, before anything is written. */
function ReviewBody({ draft, hasLogo }: { draft: SchoolSetupDraft; hasLogo: boolean }) {
  const { school, session, people } = draft;
  return (
    <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto pr-1">
      <Section title="School">
        <Fact label="Name" value={school.name} />
        <Fact label="Slug" value={school.slug} />
        <Fact label="Address" value={school.location} />
        <Fact label="Registration no." value={school.registrationNo || '—'} />
        <Fact label="Logo" value={hasLogo && school.useRequestLogo ? 'The one sent with the form' : 'None'} />
      </Section>
      <PlanFacts draft={draft} />
      <Section title="Session">
        <Fact label="Year" value={`${session.startYear}–${String(session.startYear + 1).slice(-2)} (active)`} />
        <Fact label="Examinations" value={session.examNames.join(', ')} />
      </Section>
      <ClassesTable classes={draft.classes} />
      <Section title="People">
        <Fact label="You" value={people.addMeAsManager ? 'Manager' : 'Not added'} />
        <Fact label="Principal, owner" value={[people.principal.name, people.principal.phone, people.principal.email].filter(Boolean).join(' · ')} />
      </Section>
    </div>
  );
}

export function ReviewDialog({
  draft,
  hasLogo,
  open,
  creating,
  error,
  onCancel,
  onConfirm,
}: {
  draft: SchoolSetupDraft;
  hasLogo: boolean;
  open: boolean;
  creating: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onCancel())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create {draft.school.name || 'the school'}?</DialogTitle>
          <DialogDescription>This is everything the setup will create. It runs in the background; you can leave this page.</DialogDescription>
        </DialogHeader>
        <ReviewBody draft={draft} hasLogo={hasLogo} />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={creating} onClick={onCancel}>
            Keep editing
          </Button>
          <Button type="button" disabled={creating} onClick={onConfirm}>
            {creating ? 'Starting…' : 'Create school'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
