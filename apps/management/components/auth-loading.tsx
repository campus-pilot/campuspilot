import { LoaderCircle } from 'lucide-react';

export function AuthLoading({
  label = 'Checking your session…',
  fullScreen = true,
}: {
  label?: string;
  fullScreen?: boolean;
}) {
  const className = fullScreen
    ? 'grid min-h-svh place-items-center bg-background px-6'
    : 'grid min-h-64 place-items-center';

  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}
