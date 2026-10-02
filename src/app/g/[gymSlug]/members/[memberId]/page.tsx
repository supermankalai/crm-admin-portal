import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, HeartPulse, Phone, QrCode } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { LinkTabs } from "@/components/link-tabs";
import { MemberAvatar } from "@/components/members/member-avatar";
import { MembershipStateBadge, MemberStatusBadge } from "@/components/members/member-badges";
import { MemberQr } from "@/components/members/member-qr";
import { Button } from "@/components/ui/button";
import { formatInvoiceNumber } from "@/domain/billing";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ageOn, formatDate, formatDateTime } from "@/domain/dates";
import { daysRemaining } from "@/domain/membership";
import { formatMemberNumber } from "@/domain/member-search";
import { formatMoney } from "@/domain/money";
import { ROLE_LABELS } from "@/domain/permissions";
import { NotFoundError } from "@/server/errors";
import { getMemberProfile } from "@/server/services/members/profile";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { MemberActions } from "./member-actions";
import { MembershipActions } from "./membership-actions";
import { NoteForm } from "./note-form";

export const metadata: Metadata = { title: "Member" };

const TABS = ["overview", "memberships", "payments", "attendance", "notes"] as const;
type Tab = (typeof TABS)[number];

const METHOD: Record<string, string> = { CASH: "Cash", CARD: "Card", TRANSFER: "Bank transfer", QR: "QR code", MEMBER_ID: "Member ID", NAME_SEARCH: "Name search" };
const RESULT: Record<string, { label: string; variant: "success" | "warning" | "info" }> = {
  ALLOWED: { label: "Checked in", variant: "success" },
  DENIED_EXPIRED: { label: "Denied — expired", variant: "warning" },
  DENIED_FROZEN: { label: "Denied — frozen", variant: "info" },
  DENIED_NO_MEMBERSHIP: { label: "Denied — no membership", variant: "warning" },
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function MemberProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ gymSlug: string; memberId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { gymSlug, memberId } = await params;
  const ctx = await requireGymAccess(gymSlug);
  if (!hasPermission(ctx, "members.view")) return <AccessDenied what="members" />;
  const profile = await getMemberProfile(ctx, memberId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { member, today, permissions } = profile;
  const name = `${member.firstName} ${member.lastName}`;
  const writable = ctx.access.writable && !ctx.supportSessionId;
  const requested = (await searchParams).tab as Tab | undefined;
  const available = TABS.filter((t) => (t === "payments" ? permissions.canSeePayments : t === "notes" ? permissions.canSeeNotes : true));
  const tab: Tab = requested && available.includes(requested) ? requested : "overview";
  const base = `/g/${gymSlug}/members/${memberId}`;
  const current = profile.memberships.find((m) => m.state === "active" || m.state === "frozen");
  const tz = ctx.gym.timezone;

  return (
    <>
      <Link href={`/g/${gymSlug}/members`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Members
      </Link>

      <div className="mb-4 flex flex-wrap items-start gap-4">
        <MemberAvatar name={name} gymSlug={gymSlug} photoFileId={member.photoFileId} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{formatMemberNumber(member.memberNumber)}</span>
            <MemberStatusBadge status={profile.status} />
            {current && (
              <span>
                {current.planName} · {current.state === "frozen" ? "frozen" : `${daysRemaining(current, today)} days left`}
              </span>
            )}
            <span>· Member since {formatDate(member.joinedAt, tz)}</span>
          </div>
        </div>
        {writable && hasPermission(ctx, "payments.record") && (
          <Button asChild>
            <Link href={`/g/${gymSlug}/payments/sell?memberId=${member.id}`}>{current ? "Renew membership" : "Sell membership"}</Link>
          </Button>
        )}
        {writable && (
          <MemberActions
            gymSlug={gymSlug}
            memberId={member.id}
            memberName={name}
            canEdit={hasPermission(ctx, "members.edit") || hasPermission(ctx, "members.editContact")}
            canDelete={hasPermission(ctx, "members.delete")}
            canUploadPhoto={hasPermission(ctx, "members.edit") || hasPermission(ctx, "members.editContact")}
          />
        )}
      </div>

      {member.hasHealthNotes && permissions.canSeeHealth && (
        <div role="note" className="mb-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <HeartPulse className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <p>
            <span className="font-medium">Health note: </span>
            {member.healthNotes}
          </p>
        </div>
      )}

      <LinkTabs
        label="Member sections"
        active={tab}
        tabs={available.map((t) => ({
          key: t,
          label: t[0].toUpperCase() + t.slice(1),
          href: t === "overview" ? base : `${base}?tab=${t}`,
          count: t === "memberships" ? profile.memberships.length : t === "notes" ? profile.notes.length : undefined,
        }))}
      />

      <div className="mt-4">
        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Contact</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-3">
                  <Detail label="Phone">{member.phone}</Detail>
                  <Detail label="Email">{member.email}</Detail>
                  <Detail label="Address">{member.address}</Detail>
                  <Detail label="Date of birth">{member.dateOfBirth && `${formatDate(member.dateOfBirth)} (age ${ageOn(member.dateOfBirth, today)})`}</Detail>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="size-4" aria-hidden /> Emergency contact
                </CardTitle>
              </CardHeader>
              <CardContent>
                {member.emergencyContact?.name ? (
                  <dl className="grid gap-3">
                    <Detail label="Name">{member.emergencyContact.name}</Detail>
                    <Detail label="Phone">{member.emergencyContact.phone}</Detail>
                    <Detail label="Relation">{member.emergencyContact.relation}</Detail>
                  </dl>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-4" aria-hidden /> No emergency contact on file.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <QrCode className="size-4" aria-hidden /> Check-in
                </CardTitle>
                <CardDescription>Code used on the member&apos;s QR card</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-3">
                  <MemberQr code={member.checkInCode} label={`Check-in QR code for ${name}`} />
                  <Detail label="Visits (last 30 days)">{profile.visits.last30Days}</Detail>
                  <Detail label="Visits (all time)">{profile.visits.total}</Detail>
                  <Detail label="Trainer">{profile.trainers.map((t) => t.name).join(", ")}</Detail>
                </dl>
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "memberships" && (
          <Card className="gap-0 py-0">
            {profile.memberships.length === 0 ? (
              <EmptyState title="No memberships yet" description="Use Sell membership to start one." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Plan</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Freezes</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profile.memberships.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <span className="font-medium">{m.planName}</span>
                        {m.classCreditsRemaining !== null && <span className="block text-xs text-muted-foreground">{m.classCreditsRemaining} classes left</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatDate(m.startDate)} – {formatDate(m.endDate)}
                        {m.cancelReason && <span className="block text-muted-foreground">Cancelled: {m.cancelReason}</span>}
                      </TableCell>
                      <TableCell>
                        <MembershipStateBadge state={m.state} cancelling={!!m.cancelledAt} />
                      </TableCell>
                      <TableCell className="tabular-nums">{formatMoney(m.priceMinor, ctx.gym.currency)}</TableCell>
                      <TableCell className="text-xs">
                        {m.freeze.allowed ? `${m.freeze.usedDays} / ${m.freeze.maxDays} days used` : "Not allowed"}
                        {m.freezes.map((f) => (
                          <span key={f.id} className="block text-muted-foreground">
                            {formatDate(f.startDate)} – {formatDate(f.endDate)}
                          </span>
                        ))}
                      </TableCell>
                      <TableCell>
                        {writable && hasPermission(ctx, "members.edit") && (
                          <MembershipActions
                            gymSlug={gymSlug}
                            memberId={member.id}
                            membershipId={m.id}
                            state={m.state}
                            cancelling={!!m.cancelledAt}
                            freeze={m.freeze}
                            cancellation={m.cancellation}
                            currency={ctx.gym.currency}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        )}

        {tab === "payments" && permissions.canSeePayments && (
          <div className="grid gap-4">
            {profile.openInvoices.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Outstanding invoices</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {profile.openInvoices.map((inv) => {
                    const overdue = inv.dueDate.toISOString().slice(0, 10) < today;
                    return (
                      <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                        <Link href={`/g/${gymSlug}/invoices/${inv.id}`} className="font-mono hover:underline">
                          {formatInvoiceNumber(inv.number)}
                        </Link>
                        <span>
                          {formatMoney(inv.totalMinor - inv.amountPaidMinor, inv.currency)} due {formatDate(inv.dueDate.toISOString().slice(0, 10))}
                        </span>
                        <Badge variant={overdue ? "danger" : "secondary"}>{overdue ? "Overdue" : "Open"}</Badge>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
            <Card className="gap-0 py-0">
              {profile.payments.length === 0 ? (
                <EmptyState title="No payments yet" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Date</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profile.payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs">{formatDateTime(p.receivedAt, tz)}</TableCell>
                        <TableCell className="font-mono text-xs">{p.invoice ? formatInvoiceNumber(p.invoice.number) : "—"}</TableCell>
                        <TableCell className="text-xs">
                          {METHOD[p.method]}
                          {p.reference && <span className="block text-muted-foreground">{p.reference}</span>}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatMoney(p.amountMinor, p.currency)}
                          {p.refundedMinor > 0 && <span className="block text-xs text-muted-foreground">−{formatMoney(p.refundedMinor, p.currency)} refunded</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={p.status === "COMPLETED" ? "success" : p.status === "VOID" ? "secondary" : "warning"}>{p.status.replace("_", " ").toLowerCase()}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>
        )}

        {tab === "attendance" && (
          <Card className="gap-0 py-0">
            <CardHeader className="py-5">
              <CardTitle>Recent check-ins</CardTitle>
              <CardDescription>
                {profile.visits.last30Days} visits in the last 30 days · {profile.visits.total} in total
              </CardDescription>
            </CardHeader>
            {profile.checkIns.length === 0 ? (
              <EmptyState title="No check-ins yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>When</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profile.checkIns.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs">{formatDateTime(c.checkedInAt, tz)}</TableCell>
                      <TableCell className="text-xs">{c.location.name}</TableCell>
                      <TableCell className="text-xs">{METHOD[c.method]}</TableCell>
                      <TableCell>
                        <Badge variant={RESULT[c.result].variant}>{RESULT[c.result].label}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        )}

        {tab === "notes" && permissions.canSeeNotes && (
          <div className="grid gap-4 lg:grid-cols-3">
            {writable && hasPermission(ctx, "members.notes") && (
              <Card>
                <CardContent>
                  <NoteForm gymSlug={gymSlug} memberId={member.id} />
                </CardContent>
              </Card>
            )}
            <div className="grid gap-3 lg:col-span-2">
              {profile.notes.length === 0 ? (
                <Card>
                  <EmptyState title="No staff notes yet" />
                </Card>
              ) : (
                profile.notes.map((n) => (
                  <Card key={n.id} className="gap-2 py-4">
                    <CardContent className="grid gap-1">
                      <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                      <p className="text-xs text-muted-foreground">
                        {n.author} ({ROLE_LABELS[n.authorRole]}) · {formatDateTime(n.createdAt, tz)}
                      </p>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
