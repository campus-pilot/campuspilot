'use client';

import type { ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SchoolDto } from '@campuspilot/api/routers/system-admin/school/school.dto';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@campuspilot/ui/components/avatar';
import {
  getSchoolLogoUrl,
  schoolLogoRevisionQueryKey,
} from '@/lib/school-image';

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
  const { data: logoRevision = 0 } = useQuery({
    queryKey: schoolLogoRevisionQueryKey(school.id),
    queryFn: async () => 0,
    initialData: 0,
    enabled: false,
  });
  const logoUrl = getSchoolLogoUrl(school, logoRevision);

  return (
    <Avatar
      size={size}
      className={['rounded-md after:rounded-md', className]
        .filter(Boolean)
        .join(' ')}
    >
      {logoUrl ? (
        <AvatarImage
          key={logoUrl}
          src={logoUrl}
          alt=""
          className="rounded-md"
          crossOrigin="use-credentials"
        />
      ) : null}
      <AvatarFallback className="rounded-md">
        {initials(school.name)}
      </AvatarFallback>
    </Avatar>
  );
}
