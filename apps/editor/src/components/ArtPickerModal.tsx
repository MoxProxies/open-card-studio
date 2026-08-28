import { Modal } from "./Modal";
import { ArtPanel } from "./ArtPanel";
import type { Upload } from "../api/uploads";

/**
 * The dialog form of the art library — what the editor's Image button
 * opens, so picking art already uploaded is as easy as uploading it
 * again. Same panel the Library tab renders; see TemplateBrowserModal
 * for why both a dialog and a page exist.
 */
export function ArtPickerModal({ onUse, onClose }: { onUse: (upload: Upload) => void; onClose: () => void }) {
  return (
    <ArtPanel
      onUse={(upload) => {
        onUse(upload);
        onClose();
      }}
    >
      {({ toolbar, body }) => (
        <Modal title="Your art" onClose={onClose} width="min(640px, 92vw)" testId="art-picker" toolbar={toolbar}>
          {body}
        </Modal>
      )}
    </ArtPanel>
  );
}
