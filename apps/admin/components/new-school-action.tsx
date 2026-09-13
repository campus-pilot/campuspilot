'use client';

import { useState } from 'react';
import { Button } from '@campuspilot/ui/components/button';
import { Plus } from 'lucide-react';
import { AddSchoolDialog } from './add-school-dialog';

export function NewSchoolAction() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="rounded-lg"
        onClick={() => setIsOpen(true)}
      >
        <Plus />
        New school
      </Button>
      <AddSchoolDialog open={isOpen} onOpenChange={setIsOpen} />
    </>
  );
}
