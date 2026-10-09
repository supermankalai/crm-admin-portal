import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { deletePhoto } from "@/server/services/fitness/progress";

export const DELETE = mobileRoute(api.memberDeletePhoto, ({ auth, params }) => deletePhoto(auth.member, params.photoId));
