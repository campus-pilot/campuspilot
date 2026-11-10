import { Bell } from 'lucide-react';
import { FeaturePage } from '@/components/feature-unavailable';
import { ModulePlaceholder } from '@/components/module-placeholder';

export default function NoticesPage() {
  return (
    <FeaturePage feature="notices">
      <ModulePlaceholder icon={Bell} title="Notices" description="School notices will be managed here." />
    </FeaturePage>
  );
}
