import { ShieldAlert } from 'lucide-react';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@campuspilot/ui/components/empty';

export function PermissionDenied({
  description = 'You do not have the required permission to view this.',
}: {
  description?: string;
}) {
  return (
    <Empty className="mx-auto w-full max-w-3xl border border-dashed p-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldAlert />
        </EmptyMedia>
        <EmptyTitle>Permission required</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
