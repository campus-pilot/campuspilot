import { MegaphoneOffIcon } from 'lucide-react';

import { EmptyState } from '../screen';

/**
 * Shown on the notice routes when the school does not have notices (the
 * `notices` feature is off). It is a normal state, not a failure: an old
 * bookmark or notification can still lead here, so the student is told
 * calmly and the rest of the portal keeps working.
 */
export function NoticesUnavailable() {
  return (
    <EmptyState
      icon={MegaphoneOffIcon}
      title="Notices are not available"
      description="Your school is not sharing notices in the Cadet Portal right now. Please ask your school office for help."
    />
  );
}
