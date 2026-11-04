import { lazy, Suspense, useState } from "react";
const Renderer = lazy(() => import("./PdfRenderer"));
export default function PdfOriginal(props: {
  workspace: string;
  sourceId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="pdf-original"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Original PDF pages</summary>
      {open && (
        <Suspense fallback={<p role="status">Loading PDF viewer...</p>}>
          <Renderer key={`${props.workspace}:${props.sourceId}`} {...props} />
        </Suspense>
      )}
    </details>
  );
}
