import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { trainerClients } from "@/server/services/fitness/trainer";

export const GET = mobileRoute(api.trainerClients, ({ auth }) => trainerClients(auth.staff));
