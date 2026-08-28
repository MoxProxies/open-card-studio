import { api, API_BASE_URL } from "./client";
import { getToken } from "./auth";

/**
 * Stored images — card art and avatars.
 *
 * Art used to be a base64 data URL inside the design JSON (see the
 * backend's uploads migration), which meant a design with a photo in it
 * was a multi-megabyte row that every save rewrote and every gallery
 * visitor downloaded. A design now carries a URL instead.
 */

export interface Upload {
  id: string;
  kind: "art" | "avatar";
  mime: string;
  bytes: number;
  width: number;
  height: number;
  /** Absolute, and readable without a token — art in a published design
   * has to load for signed-out visitors. */
  url: string;
  created_at: string;
}

/**
 * Sends the file as multipart, which is why this doesn't go through
 * `api.post`: that sets `Content-Type: application/json`, and a
 * multipart body needs the browser to set its own boundary.
 */
export async function uploadImage(file: File, kind: "art" | "avatar" = "art"): Promise<Upload> {
  const body = new FormData();
  body.append("file", file);
  body.append("kind", kind);

  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/uploads`, {
    method: "POST",
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
  });

  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as { message?: string; errors?: Record<string, string[]> };
    throw new Error(problem.errors?.file?.[0] ?? problem.message ?? `Upload failed (${res.status})`);
  }

  return (await res.json()) as Upload;
}

export const loadUploads = () => api.get<{ uploads: Upload[]; used_bytes: number; quota_bytes: number }>("/api/uploads");

export const deleteUpload = (id: string) => api.delete<{ id: string }>(`/api/uploads/${id}`);
