import { VISIBILITIES, VISIBILITY_LABELS, type Visibility } from "../visibility";

/** The private/unlisted/published dropdown, wherever something publishable
 * is listed — designs, templates, collections. Stops the row click from
 * firing when it sits inside a clickable row. */
export function VisibilitySelect({
  value,
  onChange,
  testId,
  width = 110,
}: {
  value: Visibility;
  onChange: (visibility: Visibility) => void;
  testId?: string;
  width?: number;
}) {
  return (
    <select
      className="cs-input"
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onChange(e.target.value as Visibility);
      }}
      style={{ width, flex: "none" }}
      title="Who can see this"
      data-testid={testId}
    >
      {VISIBILITIES.map((v) => (
        <option key={v} value={v}>
          {VISIBILITY_LABELS[v]}
        </option>
      ))}
    </select>
  );
}
