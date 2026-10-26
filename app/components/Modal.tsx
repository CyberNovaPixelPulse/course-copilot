"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function Modal({
  children,
  onClose,
  labelledBy,
  label,
  className = "",
}: {
  children: ReactNode;
  onClose: () => void;
  labelledBy?: string;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLElement>("[data-modal-return]")?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-label={label}
      className={`m-auto max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-3xl border-0 p-0 backdrop:bg-stone-900/50 ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
          ),
        ).filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
