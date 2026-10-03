/** Seed accounts and gyms. Every login listed here is documented in README.md. */

export const PASSWORDS = {
  superAdmin: "SuperAdmin#2026",
  staff: "GymStaff#2026",
  member: "Member#2026",
} as const;

/** Member app test logins (see README). */
export const MEMBER_APP = {
  accountsPerGym: 20,
  /** One person who is a member of two gyms (gym switching). */
  shared: { email: "alex.member@fitcrm.example", firstName: "Alex", lastName: "Fernandes", gyms: ["iron-temple", "zen-strength"] as const },
  /** A phone-only member login (one-time codes by SMS) at Iron Temple. */
  phoneOnly: { gym: "iron-temple", phone: "+919800000022", firstName: "Ravi", lastName: "Phone" },
  /** Pending invites with known secrets at Iron Temple, to try the redeem flow. */
  inviteCode: "WELC-OME2",
  inviteLinkToken: "demo-invite-iron-temple-member-24",
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
    featureMobileApp: false,
    featureMemberApp: false,
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
    featureMobileApp: true,
    featureMemberApp: true,
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
    featureMobileApp: true,
    featureMemberApp: true,
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
