/**
 * One visibility vocabulary for every publishable thing — designs,
 * templates, and whatever comes next — matching the backend's
 * App\Models\Concerns\Publishable exactly. Both halves of the UI copy
 * live here too, so a dropdown and its explanation never drift apart
 * between two dialogs.
 */
export type Visibility = "private" | "unlisted" | "published";

export const VISIBILITIES: Visibility[] = ["private", "unlisted", "published"];

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: "Private",
  unlisted: "Unlisted",
  published: "Published",
};

export const VISIBILITY_HELP: Record<Visibility, string> = {
  private: "Only you can see it.",
  unlisted: "Anyone with the link can open it, but it won't be listed anywhere.",
  published: "Listed publicly and on your profile, credited to you.",
};
