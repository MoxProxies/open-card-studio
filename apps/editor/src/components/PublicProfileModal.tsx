import type { Design } from "@card-studio/scene-schema";
import { Modal } from "./Modal";
import { ProfilePanel } from "./ProfilePanel";

/** The dialog form of a public profile, for the embed — see
 * TemplateBrowserModal for why both a dialog and a page exist. */
export function PublicProfileModal({
  username,
  onUseTemplate,
  onClose,
}: {
  username: string;
  onUseTemplate: (design: Design) => void;
  onClose: () => void;
}) {
  return (
    <ProfilePanel username={username} onUseTemplate={onUseTemplate}>
      {({ title, body }) => (
        <Modal title={title} onClose={onClose} width="min(600px, 92vw)" testId="public-profile">
          {body}
        </Modal>
      )}
    </ProfilePanel>
  );
}
