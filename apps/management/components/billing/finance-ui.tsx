"use client";

import type { ReactNode } from "react";
import { Button } from "@campuspilot/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@campuspilot/ui/components/empty";

export function FinanceError({ title, error }: { title: string; error: unknown }) {
  return (
    <Empty className="border border-dashed p-8">
      <EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{error instanceof Error ? error.message : "Try refreshing this page."}</EmptyDescription></EmptyHeader>
    </Empty>
  );
}

export function FinanceLoading({ rows = 3 }: { rows?: number }) {
  return <div className="flex animate-pulse flex-col gap-3">{Array.from({ length: rows }, (_, index) => <div key={index} className="h-20 rounded-xl bg-muted" />)}</div>;
}

export function FieldErrors({ errors }: { errors: unknown[] }) {
  return errors.map((error, index) => {
    const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : undefined;
    return message ? <p key={`${message}-${index}`} className="text-xs text-destructive">{message}</p> : null;
  });
}

export function PageSection({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1"><h2 className="text-base font-semibold">{title}</h2>{description ? <p className="text-xs text-muted-foreground">{description}</p> : null}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SimplePagination({ currentPage, totalPages, onPageChange }: { currentPage: number; totalPages: number; onPageChange: (page: number) => void }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-muted-foreground">Page {totalPages === 0 ? 0 : currentPage} of {totalPages}</span>
      <Button type="button" size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>Previous</Button>
      <Button type="button" size="sm" variant="outline" disabled={totalPages === 0 || currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>Next</Button>
    </div>
  );
}

