'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRightIcon, MegaphoneIcon } from 'lucide-react';
import { CadetNoticeList } from '@campuspilot/components/cadet-portal';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { Button } from '@campuspilot/ui/components/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@campuspilot/ui/components/item';

import { orpc } from '@/lib/orpc';
import { NOTICES_HREF } from '@/lib/route-param';
import { ScreenError, SectionLabel } from '../screen';
import { HOME_NOTICE_COUNT, noticeEntries, noticesSwitchedOff } from './notices-model';
import { renderNoticeLink } from './notices-screen';

/**
 * The newest notices, shared by Home's block and More's row (one cached
 * read). It doubles as the portal's answer to "does this school have
 * notices": the server refuses it with the disabled-feature error when it
 * does not.
 */
function useRecentNotices() {
  return useQuery(orpc.listNotices.queryOptions({ input: { limit: HOME_NOTICE_COUNT } }));
}

/**
 * Home's notices block: the newest few with a way to all of them. It takes
 * no space until there is something to show: nothing while loading, nothing
 * for a school without notices (feature off) and nothing when no notice has
 * been addressed to the student yet. A real failure offers a retry like
 * Home's other blocks.
 */
export function HomeNotices() {
  const notices = useRecentNotices();
  // Notices already listed stay when a refetch fails; only "notices switched off" removes them.
  const state = resolveQueryBoundary(notices, { replaces: noticesSwitchedOff });
  if (state.kind === 'pending') return null;
  if (state.kind === 'failed') {
    if (noticesSwitchedOff(state.error)) return null;
    return <ScreenError title="Could not load notices" error={state.error} onRetry={() => void notices.refetch()} />;
  }
  if (state.data.items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel
        action={
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link href={NOTICES_HREF}>All notices</Link>
          </Button>
        }
      >
        Notices
      </SectionLabel>
      <CadetNoticeList entries={noticeEntries(state.data.items)} renderLink={renderNoticeLink} />
    </section>
  );
}

/**
 * More's way to Notices. Hidden for a school without notices and until the
 * answer is known, so the row never appears and then vanishes. Shown after
 * any other failure: the Notices screen then explains and offers a retry.
 */
export function MoreNoticesRow() {
  const notices = useRecentNotices();
  if (notices.isPending || noticesSwitchedOff(notices.error)) return null;
  return (
    <ItemGroup className="gap-0 rounded-lg border">
      <Item asChild>
        <Link href={NOTICES_HREF}>
          <ItemMedia variant="icon">
            <MegaphoneIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Notices</ItemTitle>
            <ItemDescription>What your school has published for you</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </ItemActions>
        </Link>
      </Item>
    </ItemGroup>
  );
}
