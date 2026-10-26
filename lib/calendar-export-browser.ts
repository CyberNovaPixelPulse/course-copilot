import { renderShareCard, SHARE_URL } from "./shareCard";
import {
  createCalendarExport,
  type ExportDependencies,
} from "./calendar-export";
export function isAppleCalendarDevice() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export function createBrowserCalendarExport(
  accountId: string,
  options: Pick<ExportDependencies, "access">,
) {
  let imageLabels: Parameters<typeof renderShareCard>[1] = {
    heading: "This semester",
    footer: SHARE_URL,
    weekdays: {},
  };
  const flow = createCalendarExport(accountId, {
    renderImage: (courses) => renderShareCard(courses, imageLabels),
    ...options,
    prepare: async (courses, signal) => {
      const response = await fetch("/api/export-ics", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courses }),
        signal,
      });
      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body: await response.text(),
      };
    },
    deliver: (ics, method) => {
      if (method === "download")
        downloadBlob(
          new Blob([ics], { type: "text/calendar;charset=utf-8" }),
          "course-schedule.ics",
        );
      else {
        if (!isAppleCalendarDevice())
          throw new Error("此裝置請使用一般 ICS 下載");
        window.location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
      }
    },
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (id) => clearTimeout(id),
  });
  return Object.assign(flow, {
    setImageLabels: (labels: Parameters<typeof renderShareCard>[1]) => {
      imageLabels = labels;
    },
  });
}
