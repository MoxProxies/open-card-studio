import { api } from "./client";
import { logout } from "./auth";

/**
 * Data rights: take everything with you, or close the account. The
 * backend half is AccountController; these are the two calls behind the
 * buttons in ProfileModal.
 */

/** Everything the account owns, saved to a file. Resolves to the
 * filename so the caller can say what happened. */
export async function downloadMyData(): Promise<string> {
  const payload = await api.get<unknown>("/api/account/export");
  const filename = `open-card-studio-export-${new Date().toISOString().slice(0, 10)}.json`;
  // An object URL rather than a data: one — an export with a few hundred
  // designs in it is far past what a data: URL can carry in some browsers.
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Deferred: revoking synchronously can cancel the download in some
  // browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}

/**
 * Closes the account for good. `password` for a password account,
 * `confirm_username` for a social-only one (there's no password to
 * re-enter). Signs out locally afterwards, since the token is gone
 * server-side either way.
 */
export async function deleteAccount(confirmation: { password?: string; confirm_username?: string }): Promise<void> {
  await api.delete<{ message: string }>("/api/account", confirmation);
  await logout();
}
