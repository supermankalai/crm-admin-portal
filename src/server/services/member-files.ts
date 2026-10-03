import "server-only";
import { getStorage } from "@/server/storage";
import { inMember, type MemberContext } from "@/server/tenant/member";

/** Files a member may see in the app. For now: their gym's logo (RLS: member_read_gym_logo). */
export async function readMemberVisibleFile(ctx: MemberContext, fileId: string) {
  const asset = await inMember(ctx, (tx) => tx.fileAsset.findFirst({ where: { id: fileId, kind: "GYM_LOGO" }, select: { storageKey: true, mimeType: true } }));
  if (!asset) return null;
  return { mimeType: asset.mimeType, bytes: await getStorage().get(asset.storageKey) };
}
