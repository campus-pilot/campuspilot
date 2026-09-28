import { FileText } from 'lucide-react';
import { ModulePlaceholder } from '@/components/module-placeholder';

export default function ClassDocumentsPage() {
  return (
    <ModulePlaceholder
      icon={FileText}
      title="Documents"
      description="Classroom documents and shared files will appear here."
    />
  );
}
