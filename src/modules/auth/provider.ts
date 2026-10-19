import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { createEmailVerificationToken } from "better-auth/api";
import { config } from "../../config";
import { db } from "../../db/pool";
import { deliver } from "./mail";
import { authDatabase } from "./database";

export function makeAuth() {
  const env = config();
  return betterAuth({
    appName: "Snappik Local", baseURL: env.appUrl, secret: env.secret,
    database: authDatabase(db()), trustedOrigins: [env.appUrl],
    logger: { disabled: true },
    advanced: { database: { generateId: "uuid" }, disableIPTracking: true },
    emailAndPassword: {
      enabled: true, minPasswordLength: 12, maxPasswordLength: 128,
      requireEmailVerification: true, revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 1800,
      sendResetPassword: async ({ user, url }) => deliver("recovery", user.id, url),
      // Retrying a registration after an uncertain mail write must recover delivery.
      onExistingUserSignUp: async ({ user }) => {
        if (!user.emailVerified) {
          const token = await createEmailVerificationToken(env.secret, user.email, undefined, 1800);
          await deliver("verification", user.id, `${env.appUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(`${env.appUrl}/login`)}`);
        }
      },
    },
    emailVerification: {
      sendOnSignUp: true, autoSignInAfterVerification: false, expiresIn: 1800,
      sendVerificationEmail: async ({ user, url }) => deliver("verification", user.id, url),
    },
    session: { expiresIn: 43200, updateAge: 3600, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60,
      customRules: { "/sign-in/email": { window: 60, max: 10 }, "/sign-up/email": { window: 60, max: 5 }, "/request-password-reset": { window: 60, max: 5 } } },
    plugins: [twoFactor({ issuer: "Snappik Local", backupCodeOptions: { amount: 10 } }), {
      id: "operator-proof",
      schema: { operatorMfaProof: { modelName: "operator_mfa_proofs", fields: {
        sessionId: { type: "string", required: true, fieldName: "session_id", unique: true },
        verifiedAt: { type: "date", required: true, fieldName: "verified_at" },
      } } },
    }],
  });
}
let instance: ReturnType<typeof makeAuth> | undefined;
export function auth() { return instance ??= makeAuth(); }
