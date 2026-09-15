'use client';

import type { ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SchoolDto } from '@campuspilot/api/routers/system-admin/school/school.dto';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@campuspilot/ui/components/avatar';
import { orpc } from '@/lib/orpc';

type SchoolIdentity = Pick<SchoolDto, 'id' | 'logoS3Key' | 'name'>;

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function SchoolAvatar({
  school,
  size,
  className,
}: {
  school: SchoolIdentity;
  size?: ComponentProps<typeof Avatar>['size'];
  className?: string;
}) {
  const logoQuery = useQuery({
    ...orpc.school.getLogo.queryOptions({
      input: { schoolId: school.id },
    }),
    enabled: Boolean(school.logoS3Key),
    staleTime: 4 * 60 * 1_000,
  });
  const logoUrl = logoQuery.data?.url;
  /** Remount after a refresh even when two signatures share the same second. */
  const logoImageKey = logoUrl
    ? `${logoUrl}:${logoQuery.dataUpdatedAt}`
    : undefined;

  return (
    <Avatar
      size={size}
      className={['rounded-md after:rounded-md', className]
        .filter(Boolean)
        .join(' ')}
    >
      {logoUrl ? (
        <AvatarImage
          key={logoImageKey}
          src={logoUrl}
          alt=""
          className="rounded-md"
        />
      ) : null}
      <AvatarFallback className="rounded-md">
        {initials(school.name)}
      </AvatarFallback>
    </Avatar>
  );
}
