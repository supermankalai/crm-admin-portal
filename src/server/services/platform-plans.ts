import "server-only";
import { withAnonymous } from "@/server/db/context";

/** Plans offered on the pricing / sign-up pages (PlatformPlan is publicly readable under RLS). */
export function listPublicPlans() {
  return withAnonymous((tx) =>
    tx.platformPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        code: true,
        name: true,
        description: true,
        priceMonthlyMinor: true,
        currency: true,
        maxMembers: true,
        maxStaff: true,
        maxLocations: true,
        featureReports: true,
        featureCsvExport: true,
        featureClassBookings: true,
      },
    })
  );
}

export type PublicPlan = Awaited<ReturnType<typeof listPublicPlans>>[number];
