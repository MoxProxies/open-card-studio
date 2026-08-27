import { createEmptyDesign, STANDARD_CARD_SIZE_MM } from "@card-studio/scene-schema";
import { useDesignStore } from "../../store/DesignProvider";
import { LibraryPanel } from "../../components/LibraryPanel";
import { designStorage } from "../../designStorage";
import { navigate } from "../navStore";
import { Page } from "../Page";

/** Saved designs and collections. */
export function LibraryView() {
  const design = useDesignStore((s) => s.design);
  const renameDesign = useDesignStore((s) => s.renameDesign);
  const loadDesign = useDesignStore((s) => s.loadDesign);

  const openInEditor = (next: Parameters<typeof loadDesign>[0]) => {
    loadDesign(next);
    navigate({ tab: "design" });
  };

  return (
    <LibraryPanel
      design={design}
      onRename={renameDesign}
      onSave={() => designStorage.save(design)}
      onNew={() => openInEditor(createEmptyDesign(crypto.randomUUID(), STANDARD_CARD_SIZE_MM))}
      onLoad={openInEditor}
    >
      {({ toolbar, body }) => (
        <Page testId="page-library" title="Library" subtitle="Your saved designs, and the collections you've grouped them into." toolbar={toolbar}>
          {body}
        </Page>
      )}
    </LibraryPanel>
  );
}
