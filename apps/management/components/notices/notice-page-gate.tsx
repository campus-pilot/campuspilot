import type { ReactNode } from 'react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { FeaturePage } from '@/components/feature-unavailable';
import { PermissionDenied } from '@/components/permission-denied';
import { RequirePermissions } from '@/components/require-permissions';

/**
 * The two gates of every notices page, each in its own layer: the school
 * must have the `notices` feature, and the member must hold the page's
 * permission (reading for the list and a notice, drafting for the editor).
 */
export function NoticePageGate({ schoolId, action, children }: { schoolId: string; action: typeof SCHOOL_ACTIONS.READ_NOTICE | typeof SCHOOL_ACTIONS.DRAFT_NOTICE; children: ReactNode }) {
  return (
    <FeaturePage feature="notices">
      <RequirePermissions
        permissions={{ action, resource: { kind: 'school', schoolId } }}
        fallback={<PermissionDenied description="You do not have permission to open notices." />}
      >
        {children}
      </RequirePermissions>
    </FeaturePage>
  );
}
