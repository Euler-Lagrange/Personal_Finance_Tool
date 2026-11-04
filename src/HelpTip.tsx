import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { helpTopics, type HelpTopic } from "./helpContent";
import "./help.css";

const openedEvent = "finance-help-opened";

export default function HelpTip({ topic }: { topic: HelpTopic }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overButton = useRef(false),
    overPopup = useRef(false),
    pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const content = helpTopics[topic];
  const supportsPopover =
    typeof HTMLElement.prototype.showPopover === "function";

  function cancelTimer() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  function close() {
    cancelTimer();
    pinned.current = false;
    overPopup.current = false;
    setOpen(false);
  }
  function show() {
    cancelTimer();
    window.dispatchEvent(new CustomEvent(openedEvent, { detail: id }));
    setOpen(true);
  }
  function leave() {
    cancelTimer();
    // Allow the pointer to cross the small gap between the icon and its explanation.
    timer.current = setTimeout(() => {
      if (
        !overButton.current &&
        !overPopup.current &&
        !pinned.current &&
        document.activeElement !== button.current
      )
        setOpen(false);
    }, 140);
  }

  useEffect(() => {
    const anotherOpened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close();
    };
    window.addEventListener(openedEvent, anotherOpened);
    return () => {
      cancelTimer();
      window.removeEventListener(openedEvent, anotherOpened);
    };
  }, [id]);
  useEffect(() => {
    close();
  }, [topic]);

  useLayoutEffect(() => {
    if (!open || !popup.current || !button.current) return;
    const element = popup.current;
    if (supportsPopover) element.showPopover();
    const position = () => {
      const anchor = button.current?.getBoundingClientRect();
      if (!anchor || !popup.current) return;
      const box = popup.current.getBoundingClientRect();
      const left = Math.max(
        12,
        Math.min(anchor.left, window.innerWidth - box.width - 12),
      );
      const below = anchor.bottom + 8;
      const top =
        below + box.height <= window.innerHeight - 12
          ? below
          : Math.max(12, anchor.top - box.height - 8);
      popup.current.style.left = `${left}px`;
      popup.current.style.top = `${top}px`;
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Dismiss help before Escape can close an underlying edit dialog.
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!button.current?.contains(target) && !element.contains(target))
        close();
    };
    window.addEventListener("keydown", keydown, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("keydown", keydown, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open, supportsPopover]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="help-trigger"
        aria-label={`Help: ${content.title}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          overButton.current = true;
          show();
        }}
        onPointerLeave={() => {
          overButton.current = false;
          leave();
        }}
        onFocus={show}
        onBlur={() => {
          pinned.current = false;
          leave();
        }}
        onClick={() => {
          if (pinned.current) close();
          else {
            pinned.current = true;
            show();
          }
        }}
      >
        <Info size={16} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="tooltip"
            popover={supportsPopover ? "manual" : undefined}
            className="help-popover"
            onPointerEnter={() => {
              overPopup.current = true;
              cancelTimer();
            }}
            onPointerLeave={() => {
              overPopup.current = false;
              leave();
            }}
          >
            <strong>{content.title}</strong>
            <p>{content.help}</p>
          </div>,
          button.current?.closest("dialog") ?? document.body,
        )}
    </>
  );
}

export function HelpHeading({
  topic,
  children,
}: {
  topic: HelpTopic;
  children: ReactNode;
}) {
  return (
    <div className="help-heading">
      {children}
      <HelpTip topic={topic} />
    </div>
  );
}
