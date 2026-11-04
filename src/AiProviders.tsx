import { useEffect, useRef, useState } from "react";
import { command } from "./api";
import { Modal } from "./EntryDialog";
type Provider = {
  provider: string;
  revision: number;
  enabled: boolean;
  model: string;
  hasKey: boolean;
};
export default function AiProviders({ workspace }: { workspace: string }) {
  const [open, setOpen] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div className="import-toolbar">
      <button className="secondary" onClick={() => setOpen(true)}>
        Optional AI providers
      </button>
      {message && <span role="status">{message}</span>}
      {open && (
        <ProviderEditor
          key={workspace}
          workspace={workspace}
          close={() => setOpen(false)}
          saved={() => {
            setOpen(false);
            setMessage("Provider settings saved on this PC.");
          }}
        />
      )}
    </div>
  );
}
function ProviderEditor({
  workspace,
  close,
  saved,
}: {
  workspace: string;
  close: () => void;
  saved: () => void;
}) {
  const [provider, setProvider] = useState("claude"),
    [values, setValues] = useState<Provider[] | null>(null),
    [model, setModel] = useState(""),
    [enabled, setEnabled] = useState(false),
    [action, setAction] = useState("keep"),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [dirty, setDirty] = useState(false);
  const active = useRef(true),
    running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setValues(null);
    setError("");
    setKey("");
    setDirty(false);
    command<Provider[]>("ai_provider_settings", { workspace })
      .then((v) => {
        if (live) setValues(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [workspace, reload]);
  const current = values?.find((v) => v.provider === provider);
  useEffect(() => {
    setModel(current?.model ?? "");
    setEnabled(current?.enabled ?? false);
    setAction("keep");
    setKey("");
    setDirty(false);
  }, [current]);
  const discard = () =>
    !dirty || window.confirm("Discard unsaved provider settings?");
  const submit = async () => {
    if (!current || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await command("save_ai_provider", {
        workspace,
        input: {
          provider,
          revision: current.revision,
          enabled,
          model: model.trim(),
          keyAction: action,
          key: action === "replace" ? key : null,
        },
      });
      if (active.current) {
        setKey("");
        saved();
      }
    } catch (e) {
      if (active.current) setError(String(e));
    } finally {
      if (active.current) {
        setBusy(false);
        running.current = false;
      }
    }
  };
  return (
    <Modal
      title="Optional AI providers"
      busy={busy}
      onClose={() => {
        if (discard()) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p>
          Normal finance work stays offline. Enabling a provider permits
          requests only after you confirm the source material for each request.
        </p>
        <p>
          Requests use that provider's API billing or linked credits. Verify
          access and balances in its account; saving a key does not test or
          spend credits.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}{" "}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                if (discard()) setReload((n) => n + 1);
              }}
            >
              Reload provider settings
            </button>
          </p>
        )}
        {!values && !error && <p role="status">Loading provider settings...</p>}
        <fieldset disabled={busy || !values}>
          <label>
            Provider
            <select
              value={provider}
              onChange={(e) => {
                if (discard()) {
                  setProvider(e.target.value);
                  setError("");
                }
              }}
            >
              <option value="claude">Claude</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label>
            API model ID
            <input
              value={model}
              maxLength={120}
              placeholder={
                provider === "claude"
                  ? "claude-opus-5-5"
                  : "Model ID from your provider account"
              }
              onChange={(e) => {
                setModel(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          {provider === "claude" && (
            <p>
              Default: claude-opus-5-5 at high effort. Requests bill to the
              Console organization that owns the key, including Max plan API
              credits.
            </p>
          )}
          <label className="import-check">
            <input
              type="checkbox"
              checked={enabled}
              disabled={action === "remove"}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setDirty(true);
              }}
            />
            Enable requests to this provider
          </label>
          <p>
            {current?.hasKey
              ? "An API key is stored in Windows Credential Manager."
              : "No API key is stored for this workspace and provider."}
          </p>
          <label>
            API key action
            <select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setKey("");
                setDirty(true);
                if (e.target.value === "remove") setEnabled(false);
              }}
            >
              <option value="keep">Keep existing key</option>
              <option value="replace">Save or replace key</option>
              <option value="remove">Remove key and disable requests</option>
            </select>
          </label>
          {action === "replace" && (
            <label>
              New API key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                maxLength={2000}
                onChange={(e) => {
                  setKey(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
          )}
          <p>
            Keys stay on this Windows device. They are excluded from financial
            backups and laptop handoff.
          </p>
          <button
            type="submit"
            className="primary"
            disabled={
              !current ||
              (enabled && !model.trim()) ||
              (action === "replace" && !key)
            }
          >
            Save provider settings
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
