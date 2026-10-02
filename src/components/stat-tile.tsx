import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function StatTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="gap-0 py-5">
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          {label}
          {icon && <span className="[&_svg]:size-4" aria-hidden>{icon}</span>}
        </div>
        <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
