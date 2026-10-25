"use client";

import { useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteMemberAction, uploadMemberPhotoAction } from "../actions";

export function MemberActions({
  gymSlug,
  memberId,
  memberName,
  canEdit,
  canDelete,
  canUploadPhoto,
}: {
  gymSlug: string;
  memberId: string;
  memberName: string;
  canEdit: boolean;
  canDelete: boolean;
  canUploadPhoto: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Images must be 2 MB or smaller.");
      return;
    }
    const data = new FormData();
    data.set("memberId", memberId);
    data.set("file", file);
    startUpload(async () => {
      const result = await uploadMemberPhotoAction(gymSlug, data);
      if (result.ok) {
        toast.success("Photo updated.");
        router.refresh();
      } else toast.error(result.error);
      if (fileInput.current) fileInput.current.value = "";
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      {canUploadPhoto && (
        <>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="member-photo" onChange={(e) => onFile(e.target.files?.[0])} />
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <Camera aria-hidden />} Photo
          </Button>
        </>
      )}
      {canEdit && (
        <Button asChild variant="outline">
          <Link href={`/g/${gymSlug}/members/${memberId}/edit`}>
            <Pencil aria-hidden /> Edit
          </Link>
        </Button>
      )}
      {canDelete && (
        <ConfirmDialog
          title={`Delete ${memberName}?`}
          description="The member is removed from lists and can no longer check in. Their payment and attendance history is kept for your records."
          confirmLabel="Delete member"
          trigger={(open) => (
            <Button variant="outline" className="text-destructive" onClick={open}>
              <Trash2 aria-hidden /> Delete
            </Button>
          )}
          onConfirm={async () => {
            const result = await deleteMemberAction(gymSlug, { memberId });
            if (!result.ok) {
              toast.error(result.error);
              return false;
            }
            toast.success(`${memberName} was deleted.`);
            router.push(`/g/${gymSlug}/members`);
            return true;
          }}
        />
      )}
    </div>
  );
}
