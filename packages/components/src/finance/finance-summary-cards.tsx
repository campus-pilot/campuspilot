import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@campuspilot/ui/components/card";

export type FinanceSummaryItem = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
};

/** API-free summary presentation shared by session billing and admission ledgers. */
export function FinanceSummaryCards({ items }: { items: FinanceSummaryItem[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {item.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
            {item.detail ? <p className="text-xs text-muted-foreground">{item.detail}</p> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

