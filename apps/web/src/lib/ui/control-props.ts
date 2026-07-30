/* The shared prop contract for the design system's value controls.
 *
 * Every control that carries a user-editable value — Slider, Select, Switch, Toggle,
 * TextField, SearchField, SegmentedControl, ColorSwatch, EasePicker — speaks the same
 * four props. They were declared inline nine times with nothing keeping them aligned,
 * and they had already drifted: SearchField shipped without `disabled` at all, so a
 * caller could disable a TextField but not the search box beside it.
 *
 * `T` is the type the control HANDS BACK, which is not always the type it renders:
 * ColorSwatch renders three numeric params and reports one `Hsv`. So this contract is
 * deliberately about the CHANGE channel plus the three ambient concerns (enablement,
 * accessible name, caller styling) — the value prop itself stays with each control,
 * because its name and shape are the control's own business (`value` / `checked` /
 * `pressed` / `hue`+`saturation`+`brightness`).
 *
 * Extend it by intersection, and narrow it the same way where a control genuinely
 * needs more: `ControlProps<EaseSpec> & { onChange: (v: EaseSpec) => void }` re-requires
 * a callback that is optional here. IconButton is NOT a member — it is an action, not a
 * value control, and it names its accessible label `label`.
 */
export type ControlProps<T> = {
  /** Fired on every committed change; use this when the value isn't a bindable local. */
  onChange?: (v: T) => void;
  /** Inert and unfocusable; every interactive element the control renders must honour it. */
  disabled?: boolean;
  /** The control's accessible name, for controls whose visible label lives elsewhere. */
  ariaLabel?: string;
  /** Caller-supplied class, merged onto the control's own root. */
  class?: string;
};
