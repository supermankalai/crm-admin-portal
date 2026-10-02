import { ShieldAlert } from "lucide-react";

/** Shown when a signed-in staff member opens a page their role does not allow. */
export function AccessDenied({ what = "this page" }: { what?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">You don&apos;t have access to {what}</h1>
      <p className="text-sm text-muted-foreground">Your role in this gym doesn&apos;t include this. Ask the gym owner if you need it.</p>
    </div>
  );
}
