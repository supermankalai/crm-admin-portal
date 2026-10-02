import type { Metadata } from "next";
import { GymShell } from "@/components/layout/gym-shell";
import { GYM_NAV } from "@/components/layout/nav-config";
import { SubscriptionBanner } from "@/components/layout/subscription-banner";
import { SupportBanner } from "@/components/layout/support-banner";
import { ROLE_LABELS } from "@/domain/permissions";
import { listMyGyms } from "@/server/services/my-gyms";
import { requireGymAccess } from "@/server/tenant";
import { logoutAction } from "../../(auth)/actions";

type Props = { children: React.ReactNode; params: Promise<{ gymSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireGymAccess((await params).gymSlug);
  return { title: { default: ctx.gym.name, template: `%s · ${ctx.gym.name}` } };
}

export default async function GymLayout({ children, params }: Props) {
  const { gymSlug } = await params;
  const ctx = await requireGymAccess(gymSlug);
  const gyms = await listMyGyms(ctx.user.id);

  return (
    <GymShell
      gym={{ slug: ctx.gym.slug, name: ctx.gym.name, brandColor: ctx.gym.brandColor }}
      roleLabel={ctx.supportSessionId ? "Support (read-only)" : ROLE_LABELS[ctx.role]}
      user={{ name: ctx.user.name, email: ctx.user.email, isSuperAdmin: ctx.user.isSuperAdmin }}
      nav={GYM_NAV.filter((item) => ctx.permissions.has(item.permission)).map((item) => ({
        label: item.label,
        icon: item.icon,
        href: `/g/${ctx.gym.slug}/${item.path}`,
      }))}
      gyms={gyms.map(({ gym, role }) => ({ slug: gym.slug, name: gym.name, brandColor: gym.brandColor, roleLabel: ROLE_LABELS[role] }))}
      banner={
        <>
          {ctx.supportSessionId && <SupportBanner gymName={ctx.gym.name} />}
          <SubscriptionBanner access={ctx.access} canManageBilling={ctx.permissions.has("billing.manage")} />
        </>
      }
      logoutAction={logoutAction}
    >
      {children}
    </GymShell>
  );
}
