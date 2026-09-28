'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@campuspilot/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import { BookOpenCheck, FileText, ReceiptText, UserRound, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { orpc } from '@/lib/orpc';
import { AdmissionActions } from './admission-actions';

const items: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'details', label: 'Details', icon: UserRound },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'results', label: 'Results', icon: BookOpenCheck },
  { id: 'ledger', label: 'Ledger', icon: ReceiptText },
];

export function AdmissionWorkspace({ children, schoolId, admissionId }: { children: ReactNode; schoolId: string; admissionId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const admissionQuery = useQuery(orpc.school.getAdmission.queryOptions({ input: { schoolId, admissionId } }));
  const activeItem = items.find(({ id }) => pathname.endsWith(`/${id}`)) ?? items[0]!;
  const baseHref = `/school/${encodeURIComponent(schoolId)}/admission/${encodeURIComponent(admissionId)}`;
  return <section className="mx-auto flex w-full max-w-7xl flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"><div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><UserRound className="size-5" aria-hidden /></span><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Admission</p><h1 className="truncate text-xl font-semibold tracking-tight">{admissionQuery.data?.name ?? 'Loading admission…'}</h1></div></div>{admissionQuery.data ? <AdmissionActions admission={admissionQuery.data} /> : null}</div><div className="md:hidden"><Select value={activeItem.id} onValueChange={(value) => router.push(`${baseHref}/${value}`)}><SelectTrigger className="w-full" aria-label="Admission section"><SelectValue><activeItem.icon aria-hidden />{activeItem.label}</SelectValue></SelectTrigger><SelectContent align="start">{items.map((item) => <SelectItem key={item.id} value={item.id}><item.icon aria-hidden />{item.label}</SelectItem>)}</SelectContent></Select></div><div className="flex min-w-0 items-start gap-6"><aside className="hidden w-52 shrink-0 flex-col gap-1 md:flex">{items.map((item) => <Button key={item.id} asChild variant={activeItem.id === item.id ? 'secondary' : 'ghost'} className="justify-start"><Link href={`${baseHref}/${item.id}`}><item.icon aria-hidden />{item.label}</Link></Button>)}</aside><div className="min-w-0 flex-1">{children}</div></div></section>;
}
