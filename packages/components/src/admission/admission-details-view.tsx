'use client';

import type { ReactNode } from 'react';
import { Badge } from '@campuspilot/ui/components/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@campuspilot/ui/components/frame';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import type { AcademicPlacement, AdmissionRecord } from './types';

function Detail({ label, value }: { label: string; value: string | number | null }) {
  return <div className="flex min-w-0 flex-col gap-1"><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="break-words text-sm">{value ?? '—'}</dd></div>;
}

function SectionHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <FrameHeader className="items-stretch justify-between gap-3 sm:flex-row sm:items-start"><div><FrameTitle>{title}</FrameTitle><FrameDescription>{description}</FrameDescription></div>{action}</FrameHeader>;
}

export function AdmissionDetailsView({ admission, sessions, selectedSessionId, sessionLocked, placement, academicAction, onSessionChange }: {
  admission: AdmissionRecord;
  sessions: Array<{ id: string; name: string }>;
  selectedSessionId?: string;
  sessionLocked?: boolean;
  placement: AcademicPlacement | null;
  academicAction?: ReactNode;
  onSessionChange: (sessionId: string) => void;
}) {
  const academicControls = <div className="flex items-center justify-end gap-2"><Select value={selectedSessionId} disabled={sessionLocked || sessions.length === 0} onValueChange={onSessionChange}><SelectTrigger aria-label="Academic session" className="w-full sm:w-40"><SelectValue placeholder="Select a session" /></SelectTrigger><SelectContent>{sessions.map((session) => <SelectItem key={session.id} value={session.id}>{session.name}</SelectItem>)}</SelectContent></Select>{academicAction}</div>;
  return <Frame stacked dense>
    <FramePanel fit>
      <SectionHeading title="Academic information" description="Placement for the selected academic session." action={academicControls} />
      <dl className="grid gap-5 px-4 pb-4 sm:grid-cols-3"><Detail label="Roll number" value={placement?.rollNo ?? null} /><Detail label="Class" value={placement?.classLabel ?? null} /><Detail label="Section" value={placement?.sectionLabel ?? null} /></dl>
    </FramePanel>
    <FramePanel fit>
      <SectionHeading title="Personal information" description="Identity and family information held on the admission." />
      <dl className="grid gap-5 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3"><Detail label="Student name" value={admission.name} /><Detail label="Date of birth" value={admission.dob} /><Detail label="Father's name" value={admission.fatherName} /><Detail label="Mother's name" value={admission.motherName} /><div className="flex flex-col gap-1"><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</dt><dd><Badge variant={admission.registered ? 'default' : 'secondary'}>{admission.registered ? 'Registered' : 'Unregistered'}</Badge></dd></div></dl>
    </FramePanel>
    <FramePanel fit>
      <SectionHeading title="Contact information" description="How the school can reach the family." />
      <dl className="grid gap-5 px-4 pb-4 sm:grid-cols-2"><Detail label="Phone number" value={admission.phoneNo} /><Detail label="Email" value={admission.email} /><div className="sm:col-span-2"><Detail label="Address" value={admission.address} /></div></dl>
    </FramePanel>
  </Frame>;
}
