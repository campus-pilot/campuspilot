'use client';

import Link from 'next/link';
import { Table } from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { schoolHref } from '@/app/(protected)/school/[schoolId]/school-route';

/**
 * Navbar action rendered on the session detail page to navigate back to the sessions table.
 */
export function AllSessionsAction({ schoolId }: { schoolId: string }) {
  return (
    <Button variant="outline" size="sm" className="rounded-lg gap-2" asChild>
      <Link href={schoolHref(schoolId, '/sessions')}>
        <Table className="size-4" />
        <span>All sessions</span>
      </Link>
    </Button>
  );
}
