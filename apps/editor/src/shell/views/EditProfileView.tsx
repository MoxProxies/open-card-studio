import { useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Upload } from "lucide-react";
import { apiErrorMessage } from "../../api/client";
import { setCurrentUser, type AuthUser } from "../../api/auth";
import { updateProfile } from "../../api/profiles";
import { uploadImage } from "../../api/uploads";
import { navigate } from "../navStore";
import { Page } from "../Page";

/**
 * Edit your own profile — display name, public handle, bio, avatar. A
 * subpage of Profile (`#/profile/edit`), not a modal: this is exactly the
 * fields that used to live in ProfileModal (still used as-is by the embed
 * — see AccountButton.tsx), minus everything that's an account setting
 * rather than a presentation field. Those moved to Settings
 * (SettingsView.tsx) — two-factor, sessions, the unverified-email banner,
 * the email digest preference, data export, delete account.
 *
 * "Back" is just navigating to the profile itself rather than an onClose
 * callback: the URL is the state, so the browser's own back button and a
 * reload both land somewhere sensible, which a modal's dismiss never did.
 */
export function EditProfileView({ user }: { user: AuthUser }) {
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const back = () => navigate({ tab: "profile" });

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProfile({
        name: name.trim(),
        username: username.trim(),
        bio: bio.trim(),
        avatar_url: avatarUrl.trim() || null,
      });
      setCurrentUser(updated);
      setSaved(true);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save your profile. Check your connection and try again."));
    } finally {
      setSaving(false);
    }
  };

  const field = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 14, color: "var(--cs-text-muted)" };

  return (
    <Page
      testId="page-profile-edit"
      title="Edit profile"
      actions={
        <button type="button" className="cs-btn cs-active" disabled={saving} onClick={() => void submit()} data-testid="profile-save">
          {saving ? <Loader2 size={17} className="cs-spin" /> : null} Save
        </button>
      }
    >
      <div style={{ padding: "0 8px", display: "flex", flexDirection: "column", gap: 14 }}>
        <button className="cs-btn" onClick={back} style={{ alignSelf: "flex-start" }} data-testid="profile-edit-back">
          <ArrowLeft size={17} /> Profile
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={field}>
            Display name
            <input className="cs-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="profile-name" />
          </label>

          <label style={field}>
            Username
            <input
              className="cs-input"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="your-handle"
              data-testid="profile-username"
            />
            <span style={{ fontSize: 13 }}>Lowercase letters, numbers, dashes and underscores. This is how people find your profile.</span>
          </label>

          <label style={field}>
            Bio
            <textarea
              className="cs-input"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              placeholder="What kind of cards do you make?"
              data-testid="profile-bio"
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
          </label>

          <label style={field}>
            Avatar
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {avatarUrl && (
                <img
                  src={avatarUrl}
                  alt=""
                  width={40}
                  height={40}
                  style={{ borderRadius: "50%", objectFit: "cover", flex: "none", background: "var(--cs-surface-soft)" }}
                  data-testid="avatar-preview"
                />
              )}
              <input className="cs-input" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" data-testid="profile-avatar" />
              {/* Uploading fills the same field an https link goes in, so
                  there's still one source of truth for what the avatar is
                  — the upload just happens to produce the URL for you. */}
              <label className="cs-btn" style={{ cursor: "pointer", flex: "none" }} data-testid="avatar-upload">
                {avatarBusy ? <Loader2 size={17} className="cs-spin" /> : <Upload size={17} />}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setAvatarBusy(true);
                    setError(null);
                    void uploadImage(file, "avatar")
                      .then((image) => setAvatarUrl(image.url))
                      .catch((problem: Error) => setError(problem.message))
                      .finally(() => setAvatarBusy(false));
                  }}
                />
              </label>
            </div>
            <span style={{ fontSize: 13 }}>Upload an image, or paste an https link to one. Uploads are resized and stripped of camera metadata.</span>
          </label>
        </div>

        <button
          type="button"
          className="cs-btn"
          onClick={() => navigate({ tab: "profile", username: user.username })}
          disabled={!user.username}
          style={{ alignSelf: "flex-start" }}
          data-testid="profile-view-public"
        >
          <ExternalLink size={17} /> View public profile
        </button>

        {error && <p style={{ color: "var(--cs-danger)", fontSize: 15, margin: 0 }}>{error}</p>}
        {saved && !error && (
          <p style={{ color: "var(--cs-text-muted)", fontSize: 15, margin: 0 }} data-testid="profile-saved">
            Saved.
          </p>
        )}
      </div>
    </Page>
  );
}
