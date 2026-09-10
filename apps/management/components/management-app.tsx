"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@campuspilot/ui/components/card";

export default function ManagementApp() {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-8">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            CampusPilot
          </p>
          <CardTitle className="text-4xl sm:text-5xl">Management</CardTitle>
          <CardDescription>Manage CampusPilot from a dedicated workspace.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          The client-side management app is ready. Add routes under the App Router
          and keep interactive screens in client components.
        </CardContent>
      </Card>
    </main>
  );
}
