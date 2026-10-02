import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { resolveTenant } from "@/server/tenant/resolve";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/g/:gymSlug/context — the caller's role, permissions and subscription state in this gym.
 * 401 without a session; 404 (not 403) for gyms the caller does not belong to, so slugs of other
 * gyms cannot be probed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gymSlug: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  const ctx = await resolveTenant(user, (await params).gymSlug);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

  return NextResponse.json(
    {
      gym: { slug: ctx.gym.slug, name: ctx.gym.name, timezone: ctx.gym.timezone, currency: ctx.gym.currency },
      role: ctx.role,
      permissions: [...ctx.permissions],
      plan: ctx.plan,
      access: { writable: ctx.access.writable, reason: ctx.access.reason, isTrial: ctx.access.isTrial, endsAt: ctx.access.endsAt },
    },
    { headers: NO_STORE }
  );
}
