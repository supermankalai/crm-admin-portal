import "server-only";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { loginSchema } from "@/lib/validation/auth";
import { recordPlatformAudit, recordPlatformAuditStandalone } from "@/server/audit/platform-audit";
import { withAnonymous, withUser } from "@/server/db/context";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { enforce, hashIdentifier, RATE_LIMITS, RateLimitError, reset } from "@/server/security/rate-limit";
import { metaFromHeaders } from "@/server/security/request-meta";
import { verifyAgainstDummy, verifyPassword } from "./password";

/** Codes are exposed to the client; keep them generic. */
class InvalidCredentials extends CredentialsSignin {
  code = "invalid_credentials";
}
class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

type LookupRow = { id: string; name: string; passwordHash: string; sessionVersion: number; isSuperAdmin: boolean };

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: getEnv().AUTH_SECRET,
  trustHost: process.env.AUTH_TRUST_HOST === "true",
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 60 * 60 },
  // Auth.js sets HttpOnly + SameSite=Lax cookies, and Secure + __Secure- prefix on HTTPS.
  useSecureCookies: getEnv().APP_URL.startsWith("https://"),
  pages: { signIn: "/login", error: "/login" },
  logger: {
    error: (error) => {
      if (error instanceof CredentialsSignin) return; // expected; audited separately
      const cause = (error as { cause?: { err?: Error } }).cause?.err;
      logger.error("auth error", {
        name: error.name,
        message: error.message,
        cause: cause ? { name: cause.name, message: cause.message, stack: cause.stack } : undefined,
      });
    },
    warn: (code) => logger.warn("auth warning", { code }),
    debug: () => {},
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) throw new InvalidCredentials();
        const { email, password } = parsed.data;

        const meta = metaFromHeaders(request.headers);
        const ip = meta.ip ?? "unknown";
        const emailHash = hashIdentifier(email);

        try {
          await enforce([
            [RATE_LIMITS.loginPerEmailIp, emailHash, ip],
            [RATE_LIMITS.loginPerEmail, emailHash],
            [RATE_LIMITS.loginPerIp, ip],
          ]);
        } catch (error) {
          if (error instanceof RateLimitError) {
            await recordPlatformAuditStandalone({ action: "auth.login_rate_limited", metadata: { emailHash }, meta });
            throw new RateLimited();
          }
          throw error;
        }

        const rows = await withAnonymous((tx) => tx.$queryRaw<LookupRow[]>`SELECT * FROM auth_lookup_user(${email})`);
        const user = rows[0];
        const valid = user ? await verifyPassword(user.passwordHash, password) : await verifyAgainstDummy(password);

        if (!user || !valid) {
          await recordPlatformAuditStandalone({
            action: "auth.login_failed",
            actorUserId: user?.id ?? null,
            metadata: { emailHash, reason: user ? "bad_password" : "unknown_email" },
            meta,
          });
          throw new InvalidCredentials();
        }

        await reset(RATE_LIMITS.loginPerEmailIp, emailHash, ip);
        await withUser(user.id, async (tx) => {
          await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() }, select: { id: true } });
          await recordPlatformAudit(tx, { action: "auth.login", actorUserId: user.id, meta });
        });

        return { id: user.id, name: user.name, email, sessionVersion: user.sessionVersion };
      },
    }),
  ],
  callbacks: {
    // The token carries only the user id and session version. Roles and gym access are
    // re-read from the database on every request (src/server/auth/session.ts).
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sv = user.sessionVersion;
      }
      return { sub: token.sub, sv: token.sv, iat: token.iat, exp: token.exp, jti: token.jti };
    },
    session({ session, token }) {
      session.user = { id: token.sub ?? "", email: session.user?.email ?? "", name: session.user?.name ?? null, emailVerified: null };
      session.sv = typeof token.sv === "number" ? token.sv : -1;
      return session;
    },
  },
});
