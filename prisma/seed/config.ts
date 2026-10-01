/** Seed accounts and gyms. Every login listed here is documented in README.md. */

export const PASSWORDS = {
  superAdmin: "SuperAdmin#2026",
  staff: "GymStaff#2026",
} as const;

export const SUPER_ADMIN = { email: "superadmin@fitcrm.example", name: "Asha Platform" };

/** Belongs to two gyms with different roles (gym switching). */
export const SHARED_USER = { email: "priya.nair@fitcrm.example", name: "Priya Nair" };

export const PLATFORM_PLANS = [
  {
    code: "STARTER",
    name: "Starter",
    description: "For a single small studio getting started.",
    priceMonthlyMinor: 1_999_00,
    maxMembers: 150,
    maxStaff: 8,
    maxLocations: 1,
    featureReports: false,
    featureCsvExport: false,
    featureClassBookings: true,
    sortOrder: 1,
  },
  {
    code: "GROWTH",
    name: "Growth",
    description: "For growing gyms that need reporting.",
    priceMonthlyMinor: 4_999_00,
    maxMembers: 500,
    maxStaff: 20,
    maxLocations: 2,
    featureReports: true,
    featureCsvExport: false,
    featureClassBookings: true,
    sortOrder: 2,
  },
  {
    code: "PRO",
    name: "Pro",
    description: "For multi-location gyms with full exports.",
    priceMonthlyMinor: 9_999_00,
    maxMembers: 5000,
    maxStaff: 100,
    maxLocations: 10,
    featureReports: true,
    featureCsvExport: true,
    featureClassBookings: true,
    sortOrder: 3,
  },
] as const;

export type PlanCode = (typeof PLATFORM_PLANS)[number]["code"];

export type GymSpec = {
  key: "iron" | "pulse" | "zen";
  slug: string;
  name: string;
  planCode: PlanCode;
  status: "ACTIVE" | "TRIAL";
  createdDaysAgo: number;
  /** Days from today until the current period (or trial) ends. */
  periodEndsInDays: number;
  locations: string[];
  memberCount: number;
  managers: number;
  frontDesk: number;
  trainers: number;
  priceFactor: number;
  emailDomain: string;
  brandColor: string;
  /** Role of SHARED_USER in this gym, if any (counts toward the role totals above). */
  sharedUserRole?: "TRAINER" | "MANAGER";
};

export const GYMS: GymSpec[] = [
  {
    key: "iron",
    slug: "iron-temple",
    name: "Iron Temple Fitness",
    planCode: "PRO",
    status: "ACTIVE",
    createdDaysAgo: 420,
    periodEndsInDays: 18,
    locations: ["Indiranagar", "Koramangala"],
    memberCount: 190,
    managers: 2,
    frontDesk: 2,
    trainers: 5,
    priceFactor: 1.2,
    emailDomain: "irontemple.example",
    brandColor: "#ea580c",
    sharedUserRole: "TRAINER",
  },
  {
    key: "pulse",
    slug: "pulse-fitness",
    name: "Pulse Fitness Studio",
    planCode: "STARTER",
    status: "ACTIVE",
    createdDaysAgo: 300,
    periodEndsInDays: 9,
    locations: ["HSR Layout"],
    memberCount: 95,
    managers: 1,
    frontDesk: 2,
    trainers: 3,
    priceFactor: 0.8,
    emailDomain: "pulsefitness.example",
    brandColor: "#2563eb",
  },
  {
    key: "zen",
    slug: "zen-strength",
    name: "Zen Strength Collective",
    planCode: "GROWTH",
    status: "TRIAL",
    createdDaysAgo: 5,
    periodEndsInDays: 9,
    locations: ["Jayanagar"],
    memberCount: 120,
    managers: 2,
    frontDesk: 2,
    trainers: 4,
    priceFactor: 1,
    emailDomain: "zenstrength.example",
    brandColor: "#059669",
    sharedUserRole: "MANAGER",
  },
];
