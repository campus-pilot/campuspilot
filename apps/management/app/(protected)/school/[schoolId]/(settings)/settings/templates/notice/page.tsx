import { BookOpenCheck } from 'lucide-react';
import { FeaturePage } from '@/components/feature-unavailable';
import { ModulePlaceholder } from '@/components/module-placeholder';

export default function NoticeTemplatePage() {
  return (
    <FeaturePage feature="notices">
      <ModulePlaceholder icon={BookOpenCheck} title="Notice template" description="School notice templates will be configured here." />
    </FeaturePage>
  );
}

