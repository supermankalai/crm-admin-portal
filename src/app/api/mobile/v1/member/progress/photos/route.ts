import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { uploadPhoto } from "@/server/services/fitness/progress";

export const POST = mobileRoute(api.memberUploadPhoto, ({ auth, body, file }) => uploadPhoto(auth.member, file, body.takenOn));
