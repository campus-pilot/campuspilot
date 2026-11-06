'use client';

import { useState } from 'react';
import { Button } from '@campuspilot/ui/components/button';
import { FlaskConical } from 'lucide-react';
import { DemoSchoolDialog } from './demo-school-dialog';

/** Navbar action on /organizations that opens the demo school dialog. */
export function DemoSchoolAction() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="rounded-lg"
        onClick={() => setIsOpen(true)}
      >
        <FlaskConical />
        Demo school
      </Button>
      {isOpen ? <DemoSchoolDialog open onOpenChange={setIsOpen} /> : null}
    </>
  );
}
