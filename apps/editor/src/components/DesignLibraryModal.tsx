import type { Design } from "@card-studio/scene-schema";
import { Modal } from "./Modal";
import { LibraryPanel } from "./LibraryPanel";

/** The dialog form of the design library, for the embed — see
 * TemplateBrowserModal for why both a dialog and a page exist. */
export function DesignLibraryModal({
  design,
  onRename,
  onSave,
  onNew,
  onLoad,
  onClose,
}: {
  design: Design;
  onRename: (name: string) => void;
  onSave: () => Promise<unknown>;
  onNew: () => void;
  onLoad: (design: Design) => void;
  onClose: () => void;
}) {
  return (
    <LibraryPanel design={design} onRename={onRename} onSave={onSave} onNew={onNew} onLoad={onLoad}>
      {({ toolbar, body }) => (
        <Modal title="Save / load design" onClose={onClose} toolbar={toolbar}>
          {body}
        </Modal>
      )}
    </LibraryPanel>
  );
}
