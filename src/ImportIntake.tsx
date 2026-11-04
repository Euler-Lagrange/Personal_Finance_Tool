import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Upload, X } from "lucide-react";
import { command, desktop } from "./api";
import type { Workspace } from "./types";

type Item = {
  id: string;
  name: string;
  file?: File;
  path?: string;
  clipboard?: boolean;
  state: "waiting" | "reading" | "saved" | "error" | "cancelled";
  error?: string;
  purpose: "transactions" | "payroll";
};
const supported = /\.(csv|tsv|xlsx|xls|pdf|png|jpe?g|webp|bmp)$/i;
async function content(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File could not be read."));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
}
export function useImportIntake(
  workspace: Workspace,
  staged: (purpose: "transactions" | "payroll") => void,
  purpose: "transactions" | "payroll" = "transactions",
) {
  const [jobs, setJobs] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [intakeError, setIntakeError] = useState("");
  const [nativeDropWarning, setNativeDropWarning] = useState("");
  const pending = useRef<Item[]>([]),
    running = useRef(false),
    generation = useRef(0);
  const callback = useRef(staged);
  callback.current = staged;
  const current = useRef(workspace);
  current.current = workspace;
  const destination = useRef(purpose);
  destination.current = purpose;
  useEffect(() => {
    ++generation.current;
    pending.current = [];
    setJobs([]);
    setDragging(false);
    setIntakeError("");
  }, [workspace]);
  const process = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (pending.current.length) {
        const item = pending.current.shift()!;
        const target = current.current,
          token = generation.current;
        const update = (patch: Partial<Item>) => {
          if (token === generation.current)
            setJobs((old) =>
              old.map((j) => (j.id === item.id ? { ...j, ...patch } : j)),
            );
        };
        update({ state: "reading" });
        try {
          if (item.clipboard)
            await command("paste_import", {
              workspace: target,
              ...(item.purpose === "payroll" ? { purpose: "payroll" } : {}),
            });
          else if (item.path)
            await command("ingest_import_path", {
              workspace: target,
              path: item.path,
              ...(item.purpose === "payroll" ? { purpose: "payroll" } : {}),
            });
          else {
            if (
              !item.file ||
              !(
                supported.test(item.name) ||
                (item.purpose === "payroll" && /\.docx$/i.test(item.name))
              )
            )
              throw new Error(
                "Unsupported file. Use CSV, Excel, PDF, or an image.",
              );
            if (item.file.size === 0 || item.file.size > 10 * 1024 * 1024)
              throw new Error("Use a nonempty file no larger than 10 MB.");
            await command("ingest_import", {
              workspace: target,
              name: item.name,
              content: await content(item.file),
              ...(item.purpose === "payroll" ? { purpose: "payroll" } : {}),
            });
          }
          update({ state: "saved" });
          if (token === generation.current) callback.current(item.purpose);
        } catch (e) {
          update({ state: "error", error: String(e) });
        }
      }
    } finally {
      running.current = false;
    }
  }, []);
  const enqueue = useCallback(
    (
      items: (Omit<Item, "id" | "state" | "purpose"> & {
        purpose?: Item["purpose"];
      })[],
    ) => {
      const handoffs = items.filter((i) => /\.pfinance\.age$/i.test(i.name));
      if (handoffs.length) {
        if (items.length !== 1) {
          setIntakeError(
            "Drop one handoff file at a time, separately from transaction files.",
          );
          return;
        }
        setIntakeError("");
        window.dispatchEvent(
          new CustomEvent("finance-handoff-open", { detail: handoffs }),
        );
        return;
      }
      if (pending.current.length + items.length > 25) {
        setIntakeError("Add at most 25 files at a time.");
        return;
      }
      const next: Item[] = items.map((i) => ({
        ...i,
        id: crypto.randomUUID(),
        state: "waiting",
        purpose: i.purpose ?? destination.current,
      }));
      pending.current.push(...next);
      setJobs((old) => [
        ...old.filter((j) => j.state !== "saved" && j.state !== "cancelled"),
        ...next,
      ]);
      setIntakeError("");
      void process();
    },
    [process],
  );
  const addFiles = useCallback(
    (files: File[]) =>
      enqueue(files.map((file) => ({ file, name: file.name }))),
    [enqueue],
  );
  const paste = useCallback(
    () => enqueue([{ name: "Clipboard screenshot", clipboard: true }]),
    [enqueue],
  );
  useEffect(() => {
    const editing = () => {
      const el = document.activeElement;
      return (
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
      );
    };
    const onPaste = (e: ClipboardEvent) => {
      if (editing()) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setDragging(true);
      }
    };
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    document.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (desktop)
      (async () =>
        getCurrentWebview().onDragDropEvent(({ payload }) => {
          if (payload.type === "enter" || payload.type === "over")
            setDragging(true);
          if (payload.type === "leave") setDragging(false);
          if (payload.type === "drop") {
            setDragging(false);
            enqueue(
              payload.paths.map((path) => ({
                path,
                name: path.split(/[\\/]/).pop() ?? path,
              })),
            );
          }
        }))()
        .then((off) => {
          if (disposed) off();
          else unlisten = off;
        })
        .catch(() => {
          if (!disposed)
            setNativeDropWarning(
              "Native drag-and-drop is unavailable in this session. Browse or paste still works.",
            );
        });
    return () => {
      disposed = true;
      unlisten?.();
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFiles, enqueue]);
  function cancel() {
    const ids = new Set(pending.current.map((i) => i.id));
    pending.current = [];
    setJobs((old) =>
      old.map((i) => (ids.has(i.id) ? { ...i, state: "cancelled" } : i)),
    );
  }
  function retry(item: Item) {
    enqueue([
      {
        file: item.file,
        path: item.path,
        name: item.name,
        clipboard: item.clipboard,
        purpose: item.purpose,
      },
    ]);
    setJobs((old) => old.filter((i) => i.id !== item.id));
  }
  return {
    purpose,
    jobs,
    dragging,
    intakeError,
    nativeDropWarning,
    addFiles,
    paste,
    cancel,
    retry,
    clear: () =>
      setJobs((old) =>
        old.filter((i) => ["waiting", "reading"].includes(i.state)),
      ),
  };
}
export type Intake = ReturnType<typeof useImportIntake>;
export function DropOverlay({ intake }: { intake: Intake }) {
  return intake.dragging ? (
    <div className="drop-overlay" role="status">
      <Upload size={40} />
      <strong>
        {intake.purpose === "payroll"
          ? "Drop payroll documents for review"
          : "Drop transaction files or one handoff"}
      </strong>
      <span>
        {intake.purpose === "payroll"
          ? "DOCX · CSV · Excel · PDF · Screenshots"
          : "CSV · Excel · PDF · Screenshots · Encrypted handoff"}
      </span>
      <small>
        Your open edits stay in place. Nothing is posted automatically.
      </small>
    </div>
  ) : null;
}
export function IntakeProgress({ intake }: { intake: Intake }) {
  const active = intake.jobs.some((j) =>
    ["waiting", "reading"].includes(j.state),
  );
  return (
    <>
      {intake.nativeDropWarning && (
        <p className="import-caution" role="status">
          {intake.nativeDropWarning}
        </p>
      )}
      {intake.intakeError && (
        <p className="import-caution" role="status">
          {intake.intakeError}
        </p>
      )}
      {intake.jobs.length > 0 && (
        <div className="intake-progress" aria-label="Import intake progress">
          <div className="import-toolbar">
            <strong>
              {active ? "Saving sources locally…" : "Intake results"}
            </strong>
            <button
              className="text-button"
              onClick={active ? intake.cancel : intake.clear}
            >
              {active ? (
                "Cancel waiting files"
              ) : (
                <>
                  <X size={14} /> Clear results
                </>
              )}
            </button>
          </div>
          {intake.jobs.map((j) => (
            <div key={j.id} className="intake-job">
              <span>
                {j.name}
                {j.purpose === "payroll" ? " · Pay & hours" : ""}
              </span>
              <small>
                {j.state === "saved"
                  ? "Saved for review · totals unchanged"
                  : j.state === "reading"
                    ? "Reading locally…"
                    : j.state}
              </small>
              {j.error && <span className="error">{j.error}</span>}
              {j.state === "error" && !j.clipboard && (
                <button className="secondary" onClick={() => intake.retry(j)}>
                  Retry
                </button>
              )}
            </div>
          ))}
          {active && (
            <small>
              The current file finishes safely; cancellation stops files still
              waiting.
            </small>
          )}
        </div>
      )}
    </>
  );
}
