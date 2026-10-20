import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberProfile, updateMemberProfile } from "@/server/services/member-profile";

export const GET = mobileRoute(api.memberProfile, ({ auth }) => memberProfile(auth.member));

export const PATCH = mobileRoute(api.memberUpdateProfile, ({ auth, body, meta }) => updateMemberProfile(auth.member, body, meta));
