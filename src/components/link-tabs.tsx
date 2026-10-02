import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs (?tab=…): server-rendered, shareable, and work without JavaScript. */
export function LinkTabs({ tabs, active, label }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground",
            t.key === active ? "border-primary text-foreground" : "border-transparent"
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
