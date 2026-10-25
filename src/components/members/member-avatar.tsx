import { cn, initials } from "@/lib/utils";

/** Member photo (served through the tenant-checked file route) or initials. */
export function MemberAvatar({ name, gymSlug, photoFileId, size = "md" }: { name: string; gymSlug: string; photoFileId?: string | null; size?: "sm" | "md" | "lg" }) {
  const cls = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-20 text-xl" }[size];
  if (photoFileId) {
    // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image; not for the public image optimiser
    return <img src={`/api/g/${gymSlug}/files/${photoFileId}`} alt={`Photo of ${name}`} className={cn("shrink-0 rounded-full object-cover", cls)} />;
  }
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary", cls)} aria-hidden>
      {initials(name)}
    </span>
  );
}
