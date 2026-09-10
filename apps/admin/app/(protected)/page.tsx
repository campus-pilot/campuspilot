import type { Metadata } from 'next';
import { ThemeToggle } from '@campuspilot/components/theme-toggle';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campuspilot/ui/components/card';

export const metadata: Metadata = {
  title: 'Dashboard | CampusPilot Admin',
};

export default function DashboardPage() {
  return (
    <main className="relative grid min-h-screen place-items-center bg-muted/40 p-8">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            CampusPilot
          </p>
          <CardTitle className="text-4xl sm:text-5xl">Admin</CardTitle>
          <CardDescription>
            Manage CampusPilot from a dedicated workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          The system administrator workspace is ready.
        </CardContent>
      </Card>
    </main>
  );
}
