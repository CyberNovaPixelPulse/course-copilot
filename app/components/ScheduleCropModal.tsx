"use client";

import Modal from "./Modal";

import { useEffect, useState } from "react";
import ReactCrop, { centerCrop, type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

function initialCrop(): PercentCrop {
  return centerCrop({ unit: "%", width: 80, height: 70 }, 100, 100);
}

export default function ScheduleCropModal({
  file,
  title,
  hint,
  confirmLabel,
  skipLabel,
  busy,
  onConfirm,
  onSkip,
  error,
  onDiscard,
  onCancel,
  discardLabel,
  cancelLabel,
}: {
  file: File;
  title: string;
  hint: string;
  confirmLabel: string;
  skipLabel: string;
  busy: boolean;
  onConfirm: (crop: PercentCrop, image: HTMLImageElement) => void;
  onSkip: () => void;
  error?: string | null;
  onDiscard: () => void;
  onCancel: () => void;
  discardLabel: string;
  cancelLabel: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<PercentCrop>(initialCrop);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(file);
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setUrl(next);
        setCrop(initialCrop());
        setImage(null);
      }
    });
    return () => {
      active = false;
      URL.revokeObjectURL(next);
    };
  }, [file]);

  return (
    <Modal
      onClose={() => {
        if (!busy) onCancel();
      }}
      labelledBy="crop-title"
      className="w-full max-w-3xl bg-white"
    >
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl">
        <div className="border-b border-stone-200 px-5 py-4">
          <h2 id="crop-title" className="text-lg font-semibold text-stone-900">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">{hint}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-stone-100 p-4">
          {url ? (
            <ReactCrop
              crop={crop}
              onChange={(_pixel, percent) => setCrop(percent)}
              keepSelection
              minWidth={48}
              minHeight={48}
              ruleOfThirds
              className="mx-auto max-w-full"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                onLoad={(event) => setImage(event.currentTarget)}
                className="mx-auto max-h-[min(60vh,32rem)] w-auto max-w-full"
              />
            </ReactCrop>
          ) : null}
        </div>
        {error && (
          <p role="alert" className="px-5 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-stone-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3 py-2 text-sm underline"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className="px-3 py-2 text-sm underline"
          >
            {discardLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSkip}
            className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60"
          >
            {skipLabel}
          </button>
          <button
            type="button"
            disabled={busy || !image}
            onClick={() => image && onConfirm(crop, image)}
            className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
