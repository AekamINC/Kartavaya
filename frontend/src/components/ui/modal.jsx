import React, { useEffect } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./button";
import FocusTrap from "./FocusTrap";

export function Modal({ open, onOpenChange, title, children, footer, dataTestId }) {
  const titleId = dataTestId ? `${dataTestId}-title` : "modal-title";

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Focus restore now lives in <FocusTrap>, which captures the trigger before
  // moving focus inward and restores it in its own cleanup. Keeping a second
  // copy here would fire two restores on every close.

  if (!open) return null;

  return (
    <div
      data-testid={dataTestId}
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <FocusTrap active={open}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-3xl rounded-3xl border border-borderDefault/60 bg-bgDefault/90 shadow-xl backdrop-blur"
      >
        <div className="flex items-center justify-between gap-3 border-b border-borderDefault/60 px-6 py-4">
          <div id={titleId} data-testid={`${dataTestId}-title`} className="text-sm font-semibold">
            {title}
          </div>
          <Button
            data-testid={`${dataTestId}-close`}
            variant="ghost"
            aria-label="Close dialog"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-auto px-6 py-5">{children}</div>
        {footer ? <div className="border-t border-borderDefault/60 px-6 py-4">{footer}</div> : null}
      </div>
      </FocusTrap>
    </div>
  );
}
