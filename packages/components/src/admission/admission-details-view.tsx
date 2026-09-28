'use client';

import type { ReactNode } from 'react';
import { Badge } from '@campuspilot/ui/components/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Label } from '@campuspilot/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import type { AcademicPlacement, AdmissionRecord } from './types';

function Detail({ label, value }: { label: string; value: string | number | null }) {
  return <div className="flex min-w-0 flex-col gap-1"><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="break-words text-sm">{value ?? '—'}</dd></div>;
}

function SectionHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div>{action}</CardHeader>;
}

export function AdmissionDetailsView({ admission, sessions, selectedSessionId, sessionLocked, placement, academicAction, photoEditor, onSessionChange }: {
  admission: AdmissionRecord;
  sessions: Array<{ id: string; name: string }>;
  selectedSessionId?: string;
  sessionLocked?: boolean;
  placement: AcademicPlacement | null;
  academicAction?: ReactNode;
  photoEditor: ReactNode;
  onSessionChange: (sessionId: string) => void;
}) {
  return <div className="flex flex-col gap-5">
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-1"><p className="text-sm font-medium">{admission.name}</p><p className="text-xs text-muted-foreground">Admission {admission.admissionNo}</p></div>
      <div className="flex min-w-56 flex-col gap-2"><Label htmlFor="academic-session">Academic session</Label><Select value={selectedSessionId} disabled={sessionLocked || sessions.length === 0} onValueChange={onSessionChange}><SelectTrigger id="academic-session"><SelectValue placeholder="Select a session" /></SelectTrigger><SelectContent>{sessions.map((session) => <SelectItem key={session.id} value={session.id}>{session.name}</SelectItem>)}</SelectContent></Select></div>
    </div>
    <Card><CardContent className="pt-6">{photoEditor}</CardContent></Card>
    <Card><SectionHeading title="Academic information" description="Placement for the selected academic session." action={academicAction} /><CardContent><dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Admission number" value={admission.admissionNo} /><Detail label="Roll number" value={placement?.rollNo ?? null} /><Detail label="Class" value={placement?.classLabel ?? null} /><Detail label="Section" value={placement?.sectionLabel ?? null} /></dl></CardContent></Card>
    <Card><SectionHeading title="Personal information" description="Identity and family information held on the admission." /><CardContent><dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"><Detail label="Student name" value={admission.name} /><Detail label="Date of birth" value={admission.dob} /><Detail label="Father's name" value={admission.fatherName} /><Detail label="Mother's name" value={admission.motherName} /><div className="flex flex-col gap-1"><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</dt><dd><Badge variant={admission.registered ? 'default' : 'secondary'}>{admission.registered ? 'Registered' : 'Unregistered'}</Badge></dd></div></dl></CardContent></Card>
    <Card><SectionHeading title="Contact information" description="How the school can reach the family." /><CardContent><dl className="grid gap-5 sm:grid-cols-2"><Detail label="Phone number" value={admission.phoneNo} /><Detail label="Email" value={admission.email} /><div className="sm:col-span-2"><Detail label="Address" value={admission.address} /></div></dl></CardContent></Card>
  </div>;
}
