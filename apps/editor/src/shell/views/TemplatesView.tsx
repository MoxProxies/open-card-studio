import { useDesignStore } from "../../store/DesignProvider";
import { TemplatesPanel } from "../../components/TemplatesPanel";
import { navigate } from "../navStore";
import { Page } from "../Page";

/** The community gallery as a destination rather than a dialog. */
export function TemplatesView() {
  const design = useDesignStore((s) => s.design);
  const loadDesign = useDesignStore((s) => s.loadDesign);

  return (
    <TemplatesPanel
      design={design}
      onUseTemplate={(fromTemplate) => {
        loadDesign(fromTemplate);
        // Straight to the canvas — starting a design from a template and
        // then being left on the gallery would be a dead end.
        navigate({ tab: "design" });
      }}
      onViewProfile={(username) => navigate({ tab: "profile", username })}
    >
      {({ toolbar, body }) => (
        <Page testId="page-templates" title="Templates" subtitle="Layouts published by the community — start a design from one, or share your own." toolbar={toolbar}>
          {body}
        </Page>
      )}
    </TemplatesPanel>
  );
}
