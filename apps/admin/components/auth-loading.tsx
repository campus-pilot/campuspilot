import { Loader2 } from 'lucide-react';

export function AuthLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <span>Checking access…</span>
      </div>
    </main>
  );
}
