import { LayoutDashboard } from 'lucide-react';
import { ModulePlaceholder } from '@/components/module-placeholder';

export default function DashboardPage() {
  return (
    <ModulePlaceholder
      icon={LayoutDashboard}
      title="Dashboard"
      description="Your school overview will bring the most important activity and actions together here."
    />
  );
}

