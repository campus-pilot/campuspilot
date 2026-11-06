'use client';

import { useMutation } from '@tanstack/react-query';
import { Button } from '@campuspilot/ui/components/button';
import { Download, LoaderCircle } from 'lucide-react';
import { client } from '@/lib/orpc';

/**
 * Downloads a demo school's credentials CSV through a short-lived signed URL.
 * The URL is fetched only on click, so it is never cached or prefetched.
 */
export function DemoCredentialsButton({ schoolId, size }: { schoolId: string; size?: 'sm' }) {
  const download = useMutation({
    mutationFn: () => client.systemAdmin.getDemoCredentialsDownload({ schoolId }),
    onSuccess: ({ url }) => window.location.assign(url),
  });

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="outline" size={size} disabled={download.isPending} onClick={() => download.mutate()}>
        {download.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        Download credentials (CSV)
      </Button>
      {download.isError ? (
        <p className="text-xs text-destructive">
          {download.error instanceof Error ? download.error.message : 'Unable to download the credentials.'}
        </p>
      ) : null}
    </div>
  );
}
