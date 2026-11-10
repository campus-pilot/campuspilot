'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { LogOutIcon } from 'lucide-react';
import type { CadetProfileDto } from '@campuspilot/api/routers/cadet/cadet.dto';
import { ThemeToggle } from '@campuspilot/components/theme-toggle';
import { Avatar, AvatarFallback } from '@campuspilot/ui/components/avatar';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent } from '@campuspilot/ui/components/card';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@campuspilot/ui/components/item';

import { authClient } from '@/lib/auth-client';
import { initialsOf } from '@/lib/format';
import { orpc } from '@/lib/orpc';
import { ScreenError, ScreenHeader, ScreenLoading } from '../screen';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export function ProfileCard({ profile }: { profile: CadetProfileDto }) {
  const enrollment = profile.current;
  const placement = [enrollment?.classLabel, enrollment?.sectionLabel].filter(Boolean).join(' · ');
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <Avatar size="lg">
            <AvatarFallback className="bg-primary/10 font-semibold text-primary">{initialsOf(profile.name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">{profile.name}</span>
            <span className="truncate text-xs text-muted-foreground">{profile.schoolName}</span>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <Fact label="Adm. no." value={profile.admissionNo} />
          <Fact label="Class" value={placement || '—'} />
          <Fact label="Roll" value={enrollment?.rollNo != null ? String(enrollment.rollNo) : '—'} />
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * Signs out of the Cadet Portal only (a staff session in the same browser
 * stays) and drops every cached record, so the next person on a shared
 * phone never sees this student's data.
 */
export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: async () => {
      // Better Auth reports failures in `error` rather than throwing.
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message ?? 'Unable to sign out. Please try again.');
    },
    onSuccess: () => {
      queryClient.clear();
      router.replace('/sign-in');
    },
  });
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" size="lg" className="w-full" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
        <LogOutIcon data-icon="inline-start" /> {signOut.isPending ? 'Signing out…' : 'Sign out'}
      </Button>
      {signOut.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {signOut.error.message}
        </p>
      ) : null}
    </div>
  );
}

export function MoreScreen() {
  const profile = useQuery(orpc.getProfile.queryOptions());
  return (
    <>
      <ScreenHeader title="More" />
      {profile.isPending ? (
        <ScreenLoading blocks={1} />
      ) : profile.isError ? (
        <ScreenError error={profile.error} onRetry={() => void profile.refetch()} />
      ) : (
        <ProfileCard profile={profile.data} />
      )}
      <ItemGroup className="gap-0 rounded-lg border">
        <Item>
          <ItemContent>
            <ItemTitle>Appearance</ItemTitle>
            <ItemDescription>Light, dark or match your phone</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ThemeToggle />
          </ItemActions>
        </Item>
      </ItemGroup>
      <SignOutButton />
    </>
  );
}
