import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { MemberForm } from "@/components/members/member-form";
import { NotFoundError } from "@/server/errors";
import { getMemberProfile } from "@/server/services/members/profile";
import { hasPermission, requireGymAccess } from "@/server/tenant";

export const metadata: Metadata = { title: "Edit member" };

export default async function EditMemberPage({ params }: { params: Promise<{ gymSlug: string; memberId: string }> }) {
  const { gymSlug, memberId } = await params;
  const ctx = await requireGymAccess(gymSlug);
  const fullEdit = hasPermission(ctx, "members.edit");
  if (!fullEdit && !hasPermission(ctx, "members.editContact")) return <AccessDenied what="editing members" />;
  if (!ctx.access.writable || ctx.supportSessionId) return <AccessDenied what="editing members while the gym is read-only" />;
  const { member } = await getMemberProfile(ctx, memberId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${member.firstName} ${member.lastName}`}
        description={fullEdit ? undefined : "Your role can update contact details. Ask a manager to change anything else."}
      />
      <MemberForm
        gymSlug={gymSlug}
        mode={{ kind: "edit", memberId, contactOnly: !fullEdit }}
        canManageBilling={hasPermission(ctx, "billing.manage")}
        defaults={{
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email ?? "",
          phone: member.phone ?? "",
          address: member.address ?? "",
          dateOfBirth: member.dateOfBirth ?? "",
          healthNotes: member.healthNotes ?? "",
          emergencyContact: {
            name: member.emergencyContact?.name ?? "",
            phone: member.emergencyContact?.phone ?? "",
            relation: member.emergencyContact?.relation ?? "",
          },
        }}
      />
    </div>
  );
}
