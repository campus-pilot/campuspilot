'use client';

import { redirect, useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { Button } from '@campuspilot/ui/components/button';
import { FieldError } from '@campuspilot/ui/components/field';
import { ArrowLeft, LogOut } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { AuthLoading } from './auth-loading';

export function LogoutForm() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const form = useForm({
    defaultValues: {},
    onSubmit: async () => {
      form.setErrorMap({});
      const result = await authClient.signOut();

      if (result.error) {
        form.setErrorMap({
          onSubmit: {
            form: result.error.message ?? 'Unable to log out. Please try again.',
            fields: {},
          },
        });
        return;
      }

      router.replace('/auth/login');
      router.refresh();
    },
  });

  if (isPending) return <AuthLoading fullScreen={false} />;
  if (!session) redirect('/auth/login');

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <LogOut className="size-5" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">Log out?</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            You are signed in as <span className="font-medium text-foreground">{session.user.email}</span>.
            You’ll need to sign in again to return to your school workspace.
          </p>
        </div>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Subscribe
          selector={(state) => ({
            isSubmitting: state.isSubmitting,
            errors: state.errors,
          })}
        >
          {({ isSubmitting, errors }) => (
            <>
              <FieldError errors={errors} />
              <Button type="submit" size="lg" className="h-11 w-full text-sm" disabled={isSubmitting}>
                <LogOut className="size-4" aria-hidden="true" />
                {isSubmitting ? 'Logging out…' : 'Log out'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 w-full text-sm"
                disabled={isSubmitting}
                onClick={() => router.replace('/school')}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back to school
              </Button>
            </>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}
