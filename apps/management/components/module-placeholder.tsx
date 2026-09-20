import type { LucideIcon } from 'lucide-react';

export function ModulePlaceholder({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <section className="flex min-h-[50vh] items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-muted">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </section>
  );
}

