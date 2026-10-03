import type { Metadata } from "next";
import { AlertTriangle, BellOff, CalendarClock, CreditCard, Gauge, Info } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { LinkTabs } from "@/components/link-tabs";
import { Pagination } from "@/components/pagination";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/domain/dates";
import { cn } from "@/lib/utils";
import { listNotifications, refreshNotifications } from "@/server/services/notifications";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { MarkAllRead, OpenNotification } from "./notification-actions";

export const metadata: Metadata = { title: "Notifications" };

const ICON = {
  MEMBERSHIP_EXPIRING: CalendarClock,
  PAYMENT_OVERDUE: CreditCard,
  PLAN_LIMIT_NEAR: Gauge,
  SUBSCRIPTION_EXPIRING: AlertTriangle,
  SYSTEM: Info,
} as const;

export default async function NotificationsPage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<{ view?: string; page?: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "notifications.view")) return <AccessDenied what="notifications" />;
  const sp = await searchParams;
  const unreadOnly = sp.view !== "all";
  await refreshNotifications(ctx);
  const result = await listNotifications(ctx, { unreadOnly, page: Number(sp.page) || 1 });
  const base = `/g/${ctx.gym.slug}/notifications`;
  const canWrite = ctx.access.writable && !ctx.supportSessionId;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Alerts for expiring memberships, overdue payments and your plan. Only you see your notifications."
        actions={canWrite && <MarkAllRead gymSlug={ctx.gym.slug} disabled={result.unread === 0} />}
      />
      <LinkTabs
        label="Notification views"
        active={unreadOnly ? "unread" : "all"}
        tabs={[
          { key: "unread", label: "Unread", href: base, count: result.unread },
          { key: "all", label: "All", href: `${base}?view=all` },
        ]}
      />
      <Card className="mt-4 gap-0 py-0">
        {result.rows.length === 0 ? (
          <EmptyState icon={<BellOff />} title={unreadOnly ? "You're all caught up" : "No notifications yet"} description={ctx.supportSessionId ? "Support access doesn't show staff notifications." : undefined} />
        ) : (
          <ul className="divide-y" aria-label="Notifications">
            {result.rows.map((n) => {
              const Icon = ICON[n.type];
              const unread = !n.readAt;
              return (
                <li key={n.id} className={cn("flex items-start gap-3 p-4", unread && "bg-primary/5")}>
                  <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", unread ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")} aria-hidden>
                    <Icon className="size-4" />
                  </span>
                  <OpenNotification gymSlug={ctx.gym.slug} id={n.id} unread={unread && canWrite} hasTarget={!!n.entityType && canWrite}>
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {n.title}
                      {unread && (
                        <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground uppercase" aria-label="Unread">
                          New
                        </span>
                      )}
                    </span>
                    <span className="block text-sm text-muted-foreground">{n.body}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{formatDateTime(n.createdAt, ctx.gym.timezone)}</span>
                  </OpenNotification>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} noun="notifications" basePath={base} params={{ view: unreadOnly ? undefined : "all" }} />
      </Card>
    </>
  );
}
