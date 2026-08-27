import { api } from "./client";

/**
 * The second factor. Setting it up is two steps on purpose (see the
 * backend's TwoFactorController): `startSetup` hands back a secret to
 * scan, and it only counts as on once `confirmSetup` has checked a code
 * generated from it — otherwise a failed scan locks you out at the next
 * sign-in.
 */

export interface TwoFactorSetup {
  /** The base32 secret, for typing in by hand when a camera won't do. */
  secret: string;
  /** otpauth:// URI — what the QR code encodes. */
  otpauth_url: string;
}

export const startSetup = () => api.post<TwoFactorSetup>("/api/auth/2fa/setup");

/** Returns the recovery codes, which are readable exactly once. */
export const confirmSetup = (code: string) => api.post<{ recovery_codes: string[] }>("/api/auth/2fa/confirm", { code });

/** New recovery codes, invalidating the old set. Re-authenticates. */
export const regenerateRecoveryCodes = (confirmation: { password?: string; code?: string }) =>
  api.post<{ recovery_codes: string[] }>("/api/auth/2fa/recovery-codes", confirmation);

export const disableTwoFactor = (confirmation: { password?: string; code?: string }) => api.delete<{ message: string }>("/api/auth/2fa", confirmation);
