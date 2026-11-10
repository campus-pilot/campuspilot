'use client';

import { DemoSchoolAction } from './demo-school/demo-school-action';
import { NewSchoolAction } from './new-school-action';

/** Navbar actions of the organizations page. */
export function OrganizationActions() {
  return (
    <div className="flex items-center gap-2">
      <NewSchoolAction />
      <DemoSchoolAction />
    </div>
  );
}
