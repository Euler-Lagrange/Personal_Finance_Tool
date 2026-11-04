import { useRef, useState } from "react";
import { command } from "./api";
import type { Snapshot } from "./types";
export interface CategoryContext {
  rowId: string;
  splitMode: string;
  splitValue: string;
  amount: string;
}
interface Suggestion {
  rowId: string;
  categoryId: string | null;
  categoryAsk: boolean;
  explanations: string[];
}
export default function CategorySuggestion({
  data,
  source,
  contexts,
  disabled = false,
  choose,
}: {
  data: Snapshot;
  source: string;
  contexts: CategoryContext[];
  disabled?: boolean;
  choose: (category: string) => void;
}) {
  const [result, setResult] = useState<{
      key: string;
      items: Suggestion[];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = JSON.stringify([data.workspace, source, contexts]),
    generation = useRef(0),
    current = useRef(key);
  current.current = key;
  async function inspect() {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const items = await command<Suggestion[]>("suggest_categories", {
        workspace: data.workspace,
        source,
        contexts,
      });
      if (token === generation.current && current.current === key)
        setResult({ key, items });
    } catch (e) {
      if (current.current === key) setError(String(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  const items = result?.key === key ? result.items : [],
    categories = [...new Set(items.map((r) => r.categoryId))];
  const common =
    items.length === contexts.length &&
    items.length > 0 &&
    categories.length === 1 &&
    categories[0] &&
    items.every((r) => !r.categoryAsk)
      ? categories[0]
      : null;
  return (
    <div className="category-suggestion">
      <button
        className="text-button"
        type="button"
        disabled={disabled || busy || !contexts.length}
        onClick={() => void inspect()}
      >
        {busy ? "Checking rules..." : "Check category suggestions"}
      </button>
      {result?.key === key && (
        <div role="status">
          {common ? (
            <>
              <span>
                Suggested category:{" "}
                <strong>
                  {data.categories.find((c) => c.id === common)?.name ?? common}
                </strong>
              </span>
              <button
                className="text-button"
                type="button"
                disabled={disabled}
                onClick={() => choose(common)}
              >
                Use suggested category
              </button>
            </>
          ) : (
            <span>
              {items.some((r) => r.categoryAsk)
                ? "Choose sharing or resolve conflicting category rules before applying a suggestion."
                : categories.length > 1
                  ? "Selected purchases have different category suggestions. Review a smaller group or choose a category manually."
                  : "No category rule matches this choice. Choose a category manually."}
            </span>
          )}
          <small>
            {[...new Set(items.flatMap((r) => r.explanations))]
              .slice(0, 6)
              .join("; ")}
          </small>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
