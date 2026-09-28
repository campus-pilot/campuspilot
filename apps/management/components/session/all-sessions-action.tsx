'use client';

import Link from 'next/link';
import { Table } from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { schoolHref } from '@/components/school-route';

/** Links a session detail route back to the complete session list. */
export function AllSessionsAction({ schoolId }: { schoolId: string }) {
  return (
    <Button variant="outline" size="sm" className="gap-2 rounded-lg" asChild>
      <Link href={schoolHref(schoolId, '/settings/session')}>
        <Table className="size-4" />
        <span>All sessions</span>
      </Link>
    </Button>
  );
}
