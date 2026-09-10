'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@campuspilot/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campuspilot/ui/components/card';
import { authClient } from '@/lib/auth-client';

export function AccessDenied({ email }: { email: string }) {
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.replace('/sign-in');
  }

  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>
            {email} is signed in, but is not the configured system administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
