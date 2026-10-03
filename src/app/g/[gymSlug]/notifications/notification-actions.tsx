"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markAllReadAction, openNotificationAction } from "./actions";

export function OpenNotification({ gymSlug, id, unread, hasTarget, children }: { gymSlug: string; id: string; unread: boolean; hasTarget: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!unread && !hasTarget) return <div className="min-w-0 flex-1">{children}</div>;
  return (
    <button
      type="button"
      disabled={pending}
      className="min-w-0 flex-1 rounded-md text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
      onClick={() =>
        startTransition(async () => {
          const r = await openNotificationAction(gymSlug, { notificationId: id });
          if (!r.ok) return void toast.error(r.error);
          if (r.data.href) router.push(r.data.href);
          else router.refresh();
        })
      }
    >
      {children}
    </button>
  );
}

export function MarkAllRead({ gymSlug, disabled }: { gymSlug: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const r = await markAllReadAction(gymSlug, {});
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.data.marked === 1 ? "1 notification marked as read." : `${r.data.marked} notifications marked as read.`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCheck aria-hidden />} Mark all as read
    </Button>
  );
}
