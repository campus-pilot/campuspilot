'use client';

import {
  getProfileImageUrl,
  uploadProfileImage,
} from '@campuspilot/auth/profile-image.client';
import { ProfileImageEditor } from '@campuspilot/components/profile-image-editor';
import { env } from '@campuspilot/env/management.client';
import { authClient } from '@/lib/auth-client';

export function AccountProfileImage({ name }: { name: string }) {
  const { data: session, refetch } = authClient.useSession();

  return (
    <ProfileImageEditor
      name={name}
      imageUrl={getProfileImageUrl(
        env.NEXT_PUBLIC_SERVER_URL,
        session?.user.profileImageS3Key,
      )}
      onUpload={async (file, options) => {
        await uploadProfileImage(
          env.NEXT_PUBLIC_SERVER_URL,
          file,
          options,
        );
        await refetch();
      }}
    />
  );
}
