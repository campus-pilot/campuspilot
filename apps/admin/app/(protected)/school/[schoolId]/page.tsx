'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { orpc } from '@/lib/orpc';

export default function SchoolPage() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const schoolQuery = useQuery(orpc.systemAdmin.getSchool.queryOptions({ input: { id: schoolId } }));

  if (schoolQuery.isPending) return <p className="text-sm text-muted-foreground">Loading school…</p>;
  if (schoolQuery.isError) return <p role="alert" className="text-sm text-destructive">Unable to load this school.</p>;

  return (
    <Card>
      <CardHeader><CardTitle>{schoolQuery.data.name}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>{schoolQuery.data.location}</p>
        <p className="text-muted-foreground">{schoolQuery.data.registrationNo ?? 'No registration number'}</p>
      </CardContent>
    </Card>
  );
}
