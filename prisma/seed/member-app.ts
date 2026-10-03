import type { PrismaClient } from "@/generated/prisma/client";
import { encryptField, phoneBlindIndex, userPhoneBlindIndex, userPhoneContext } from "@/server/crypto";
import { inviteCodeHash, inviteLinkHash } from "@/server/mobile/crypto";
import { GYMS, MEMBER_APP } from "./config";
import { at, id } from "./lib";

/**
 * Member app accounts (Phase 1 of the mobile app). Runs after every gym is seeded and uses no
 * faker, so the rest of the seed stays identical. Personal data goes through the app's encryption.
 *
 *   member1…member20@<gym domain>   (password PASSWORDS.member)
 *   alex.member@fitcrm.example       member of Iron Temple and Zen Strength
 *   +91 98000 00022                  phone-only member at Iron Temple (one-time code login)
 */
export async function seedMemberApp(db: PrismaClient, ctx: { memberPasswordHash: string }) {
  const gymIds = new Map<string, string>();
  for (const spec of GYMS) {
    const gym = await db.gym.findUniqueOrThrow({ where: { slug: spec.slug }, select: { id: true } });
    gymIds.set(spec.slug, gym.id);
    const members = await db.member.findMany({ where: { gymId: gym.id, deletedAt: null }, orderBy: { memberNumber: "asc" }, take: 24, select: { id: true, firstName: true, lastName: true } });

    const users = members.slice(0, MEMBER_APP.accountsPerGym).map((m, i) => ({
      id: id(),
      memberId: m.id,
      email: `member${i + 1}@${spec.emailDomain}`,
      name: `${m.firstName} ${m.lastName}`,
    }));
    for (const u of users) await db.member.update({ where: { id: u.memberId }, data: { email: u.email } });
    await db.user.createMany({ data: users.map((u) => ({ id: u.id, email: u.email, name: u.name, passwordHash: ctx.memberPasswordHash, createdAt: at(-30, 10) })) });
    await db.memberAccount.createMany({ data: users.map((u) => ({ gymId: gym.id, memberId: u.memberId, userId: u.id, createdAt: at(-30, 10) })) });

    if (spec.slug === MEMBER_APP.phoneOnly.gym) {
      // Member #22: phone-only login.
      const m = members[21];
      const { phone, firstName, lastName } = MEMBER_APP.phoneOnly;
      await db.member.update({
        where: { id: m.id },
        data: { firstName, lastName, email: null, phoneEnc: encryptField(phone, { gymId: gym.id, model: "Member", field: "phone", recordId: m.id }), phoneBlindIndex: phoneBlindIndex(gym.id, phone) },
      });
      const userId = id();
      await db.user.create({ data: { id: userId, email: null, phoneEnc: encryptField(phone, userPhoneContext(userId)), phoneBlindIndex: userPhoneBlindIndex(phone), name: `${firstName} ${lastName}`, passwordHash: ctx.memberPasswordHash, createdAt: at(-20, 10) } });
      await db.memberAccount.create({ data: { gymId: gym.id, memberId: m.id, userId, createdAt: at(-20, 10) } });

      // Members #23 and #24: pending invites with known secrets (front-desk code, emailed link).
      const owner = await db.staffMember.findFirstOrThrow({ where: { gymId: gym.id, role: "OWNER" }, select: { id: true } });
      for (const [i, channel, hash] of [
        [22, "CODE", inviteCodeHash(MEMBER_APP.inviteCode)],
        [23, "EMAIL", inviteLinkHash(MEMBER_APP.inviteLinkToken)],
      ] as const) {
        const invitee = members[i];
        const email = `member${i + 1}@${spec.emailDomain}`;
        await db.member.update({ where: { id: invitee.id }, data: { email } });
        await db.memberAppInvite.create({
          data: { gymId: gym.id, memberId: invitee.id, channel, tokenHash: hash, email, expiresAt: at(30, 23), createdById: owner.id, createdAt: at(-1, 10) },
        });
      }
    }
  }

  // One person, member of two gyms: member #21 in each becomes "Alex Fernandes".
  const { shared } = MEMBER_APP;
  const alexId = id();
  await db.user.create({ data: { id: alexId, email: shared.email, name: `${shared.firstName} ${shared.lastName}`, passwordHash: ctx.memberPasswordHash, createdAt: at(-60, 10) } });
  for (const slug of shared.gyms) {
    const gymId = gymIds.get(slug)!;
    const m = await db.member.findFirstOrThrow({ where: { gymId, deletedAt: null }, orderBy: { memberNumber: "asc" }, skip: 20, select: { id: true } });
    await db.member.update({ where: { id: m.id }, data: { firstName: shared.firstName, lastName: shared.lastName, email: shared.email } });
    await db.memberAccount.create({ data: { gymId, memberId: m.id, userId: alexId, createdAt: at(-60, 10) } });
  }
}
