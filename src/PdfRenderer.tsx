import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { command } from "./api";
GlobalWorkerOptions.workerSrc = workerUrl;
export default function PdfRenderer({
  workspace,
  sourceId,
  sourceCommand = "pdf_original",
}: {
  workspace: string;
  sourceId: string;
  sourceCommand?: "pdf_original" | "pay_source_original";
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1),
    [width, setWidth] = useState(600),
    [reload, setReload] = useState(0),
    [loading, setLoading] = useState(true),
    [rendering, setRendering] = useState(false),
    [error, setError] = useState("");
  const area = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let task: PDFDocumentLoadingTask | undefined;
    setLoading(true);
    setError("");
    setDocument(null);
    setPage(1);
    void (async () => {
      try {
        const encoded = await command<string>(sourceCommand, {
          workspace,
          id: sourceId,
        });
        if (!live) return;
        if (typeof encoded !== "string" || encoded.length > 14_000_000)
          throw new Error("PDF is unavailable or exceeds the viewer limit.");
        const data = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        task = getDocument({
          data,
          cMapUrl: "/pdf-assets/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdf-assets/standard_fonts/",
          wasmUrl: "/pdf-assets/wasm/",
          iccUrl: "/pdf-assets/iccs/",
          stopAtErrors: true,
          enableXfa: false,
          maxImageSize: 25_000_000,
          canvasMaxAreaInBytes: 64_000_000,
          disableAutoFetch: true,
          disableStream: true,
          disableRange: true,
          disableWorkerRendering: true,
        });
        const pdf = await task.promise;
        if (!live) return;
        if (pdf.numPages < 1 || pdf.numPages > 100)
          throw new Error(
            "Preview supports up to 100 pages. Export the original to view this document.",
          );
        setDocument(pdf);
      } catch (e) {
        if (live)
          setError(
            e instanceof Error && e.name === "PasswordException"
              ? "This PDF needs a password. Export the original and open it in your PDF reader."
              : `PDF preview unavailable. ${String(e)}`,
          );
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
      void task?.destroy().catch(() => {});
    };
  }, [workspace, sourceId, sourceCommand, reload]);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, Math.floor(entry.contentRect.width) - 24)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document || !host.current) return;
    let live = true;
    let render: RenderTask | undefined;
    const container = host.current;
    // One fresh canvas per request prevents cancelled work drawing over a later page.
    const canvas = window.document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Original PDF page ${page}`);
    container.replaceChildren(canvas);
    setRendering(true);
    setError("");
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (!live) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(width / natural.width, 1.5) * zoom;
        const viewport = pdfPage.getViewport({ scale });
        const pixels = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(12_000_000 / (viewport.width * viewport.height)),
        );
        if (!Number.isFinite(pixels) || pixels <= 0)
          throw new Error("Invalid PDF page size.");
        canvas.width = Math.max(1, Math.floor(viewport.width * pixels));
        canvas.height = Math.max(1, Math.floor(viewport.height * pixels));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        render = pdfPage.render({
          canvas,
          viewport,
          transform: [pixels, 0, 0, pixels, 0, 0],
        });
        await render.promise;
      } catch (e) {
        if (live) setError(`Page could not be rendered. ${String(e)}`);
      } finally {
        if (live) setRendering(false);
      }
    })();
    return () => {
      live = false;
      render?.cancel();
      container.replaceChildren();
    };
  }, [document, page, zoom, width]);
  return (
    <div className="pdf-viewer">
      <p>
        Original document, rendered on this device. Viewing does not import its
        values.
      </p>
      {document && (
        <div className="pdf-viewer-controls">
          <button
            type="button"
            className="secondary"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous PDF page
          </button>
          <label>
            PDF page
            <select
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
            >
              {Array.from({ length: document.numPages }, (_, n) => (
                <option key={n + 1} value={n + 1}>
                  {n + 1} of {document.numPages}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary"
            disabled={page === document.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next PDF page
          </button>
          <label>
            PDF zoom
            <select
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {[
                [1, "Fit width"],
                [1.5, "150%"],
                [2, "200%"],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {(loading || rendering) && (
        <p role="status">
          {loading ? "Opening original PDF..." : "Rendering PDF page..."}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}{" "}
          <button
            type="button"
            className="secondary"
            onClick={() => setReload((n) => n + 1)}
          >
            Retry PDF preview
          </button>
        </p>
      )}
      <div
        className="pdf-canvas-scroll"
        ref={area}
        tabIndex={document ? 0 : undefined}
        aria-label="Scrollable original PDF"
      >
        <div ref={host} />
      </div>
      <p>
        Extracted text remains available separately. Links, scripts and form
        editing are not active in this preview.
      </p>
    </div>
  );
}
