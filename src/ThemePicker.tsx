import { HelpHeading } from "./HelpTip";
import { Check, Palette } from "lucide-react";
import { themes, type ThemeId } from "./themes";

export function ThemePicker({
  theme,
  onChange,
}: {
  theme: ThemeId;
  onChange: (theme: ThemeId) => void;
}) {
  return (
    <section
      className="panel settings-panel appearance-panel"
      aria-labelledby="appearance-heading"
    >
      <div className="panel-heading">
        <div>
          <HelpHeading topic="appearance">
            <h2 id="appearance-heading">Appearance</h2>
          </HelpHeading>
          <p>
            Choose a theme. Changes apply immediately and are saved on this PC.
          </p>
        </div>
        <Palette size={20} aria-hidden="true" />
      </div>
      <fieldset className="theme-options">
        <legend className="sr-only">Color theme</legend>
        {themes.map((option) => (
          <label className="theme-option" key={option.id}>
            <input
              className="theme-radio"
              type="radio"
              name="appearance-theme"
              value={option.id}
              checked={theme === option.id}
              onChange={() => onChange(option.id)}
              aria-label={option.name}
            />
            <span className="theme-option-content">
              <span
                className="theme-preview"
                data-theme={option.id}
                aria-hidden="true"
              >
                <span className="preview-sidebar">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="preview-main">
                  <span className="preview-heading" />
                  <span className="preview-cards">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="preview-table">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
              </span>
              <span className="theme-label">
                <strong>{option.name}</strong>
                <span className="theme-selection" aria-hidden="true">
                  {theme === option.id && <Check size={14} />}
                </span>
              </span>
              <span className="theme-description">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
