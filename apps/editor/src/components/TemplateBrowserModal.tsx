import type { Design } from "@card-studio/scene-schema";
import { Modal } from "./Modal";
import { TemplatesPanel } from "./TemplatesPanel";

/**
 * The dialog form of the template gallery, for the embed — which has no
 * app shell to make it a page. The standalone app navigates to
 * shell/views/TemplatesView.tsx instead; both render the same
 * TemplatesPanel.
 */
export function TemplateBrowserModal({
  design,
  onUseTemplate,
  onViewProfile,
  onClose,
}: {
  design: Design;
  onUseTemplate: (design: Design) => void;
  onViewProfile: (username: string) => void;
  onClose: () => void;
}) {
  return (
    <TemplatesPanel design={design} onUseTemplate={onUseTemplate} onViewProfile={onViewProfile}>
      {({ toolbar, body }) => (
        <Modal title="Templates" onClose={onClose} width="min(640px, 92vw)" testId="template-browser" toolbar={toolbar}>
          {body}
        </Modal>
      )}
    </TemplatesPanel>
  );
}
