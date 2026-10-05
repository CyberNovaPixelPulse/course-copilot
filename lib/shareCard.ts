import { WEEKDAYS, type Course, type Weekday } from "./types";

export const SHARE_URL = "https://ics.necterelux.com";
export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1920;

const FONT = '"PingFang TC", "Hiragino Sans", "Noto Sans TC", "Microsoft JhengHei", sans-serif';

const PALETTE = ["#4f46e5", "#db2777", "#d97706", "#059669", "#0284c7", "#7c3aed", "#0d9488", "#ea580c"];

type PlacedBlock = {
  name: string;
  startLabel: string;
  endLabel: string;
  start: number;
  end: number;
  color: string;
  col: number;
  cols: number;
};

function parseMinutes(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${pad(hours)}:${pad(minutes)}`;
}

function colorForName(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function visibleDays(courses: Course[]): Weekday[] {
  const weekend = courses.some((course) =>
    (course.slots || []).some((slot) => slot.weekday === "Saturday" || slot.weekday === "Sunday"),
  );
  return weekend ? [...WEEKDAYS] : WEEKDAYS.slice(0, 5);
}

function timeWindow(courses: Course[]) {
  let min = Infinity;
  let max = -Infinity;
  for (const course of courses) {
    for (const slot of course.slots || []) {
      const start = parseMinutes(slot.startTime);
      const end = parseMinutes(slot.endTime);
      if (start == null || end == null || end <= start) continue;
      min = Math.min(min, start);
      max = Math.max(max, end);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { start: 8 * 60, end: 18 * 60 };
  }
  let start = Math.max(7 * 60, Math.floor(min / 60) * 60);
  let end = Math.min(22 * 60, Math.ceil(max / 60) * 60);
  if (end <= start) end = start + 60;
  if (end - start < 6 * 60) {
    const extra = 6 * 60 - (end - start);
    start = Math.max(7 * 60, start - Math.floor(extra / 2));
    end = Math.min(22 * 60, start + Math.max(6 * 60, max - start));
    if (end - start < 6 * 60) end = Math.min(22 * 60, start + 6 * 60);
  }
  return { start, end };
}

function layoutDay(
  courses: Course[],
  day: Weekday,
): PlacedBlock[] {
  const drafts: Omit<PlacedBlock, "col" | "cols">[] = [];
  for (const course of courses) {
    for (const slot of course.slots || []) {
      if (slot.weekday !== day) continue;
      const start = parseMinutes(slot.startTime);
      const end = parseMinutes(slot.endTime);
      if (start == null || end == null || end <= start) continue;
      drafts.push({
        name: course.name,
        startLabel: slot.startTime,
        endLabel: slot.endTime,
        start,
        end,
        color: colorForName(course.name),
      });
    }
  }
  const sorted = drafts.sort((a, b) => a.start - b.start || a.end - b.end);
  const placed: PlacedBlock[] = [];
  const active: { end: number; col: number }[] = [];
  for (const item of sorted) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].end <= item.start) active.splice(index, 1);
    }
    const used = new Set(active.map((entry) => entry.col));
    let col = 0;
    while (used.has(col)) col += 1;
    active.push({ end: item.end, col });
    placed.push({ ...item, col, cols: 1 });
  }
  for (const item of placed) {
    const overlapping = placed.filter((other) => other.start < item.end && item.start < other.end);
    item.cols = Math.max(...overlapping.map((other) => other.col)) + 1;
  }
  return placed;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const chars = [...text];
  const lines: string[] = [];
  let current = "";
  for (let index = 0; index < chars.length; index += 1) {
    const next = current + chars[index];
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current);
      current = chars[index];
      if (lines.length === maxLines - 1) {
        current = chars.slice(index).join("");
        break;
      }
    } else {
      current = next;
    }
  }
  if (current) lines.push(fitText(ctx, current, maxWidth));
  return lines.slice(0, maxLines);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

async function loadQrImage() {
  const QRCode = (await import("qrcode")).default;
  const dataUrl = await QRCode.toDataURL(SHARE_URL, {
    margin: 1,
    width: 360,
    errorCorrectionLevel: "M",
    color: { dark: "#1e1b4b", light: "#ffffff" },
  });
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not draw QR code."));
    image.src = dataUrl;
  });
  return image;
}

export async function renderShareCard(
  courses: Course[],
  labels: { heading: string; footer: string; weekdays: Record<string, string> },
) {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw share card.");

  const background = ctx.createLinearGradient(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
  background.addColorStop(0, "#312e81");
  background.addColorStop(0.42, "#4338ca");
  background.addColorStop(1, "#111827");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  const glow = ctx.createRadialGradient(540, 160, 20, 540, 220, 560);
  glow.addColorStop(0, "rgba(255,255,255,0.2)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, 640);

  ctx.textBaseline = "top";
  ctx.fillStyle = "#e0e7ff";
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText("ics.necterelux.com", 72, 78);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 64px ${FONT}`;
  ctx.fillText(fitText(ctx, labels.heading, 920), 72, 128);

  const panelX = 48;
  const panelY = 250;
  const panelW = SHARE_CARD_WIDTH - 96;
  const panelH = 1320;
  ctx.fillStyle = "rgba(15,23,42,0.18)";
  roundRect(ctx, panelX + 8, panelY + 16, panelW, panelH, 40);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, panelX, panelY, panelW, panelH, 40);
  ctx.fill();

  const days = visibleDays(courses);
  const window = timeWindow(courses);
  const gutter = 92;
  const headerH = 78;
  const gridX = panelX + 28 + gutter;
  const gridY = panelY + 24 + headerH;
  const gridW = panelW - 56 - gutter;
  const gridH = panelH - 48 - headerH;
  const columnW = gridW / days.length;

  ctx.fillStyle = "#eef2ff";
  roundRect(ctx, panelX + 20, panelY + 20, panelW - 40, headerH - 8, 22);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.fillStyle = "#3730a3";
  ctx.font = `700 26px ${FONT}`;
  days.forEach((day, index) => {
    const label = labels.weekdays[day] ?? day;
    ctx.fillText(fitText(ctx, label, columnW - 12), gridX + columnW * index + columnW / 2, panelY + 38);
  });
  ctx.textAlign = "left";

  const hours: number[] = [];
  for (let minute = window.start; minute <= window.end; minute += 60) hours.push(minute);
  const yFor = (minute: number) =>
    gridY + ((minute - window.start) / Math.max(60, window.end - window.start)) * gridH;

  ctx.strokeStyle = "#e7e5e4";
  ctx.lineWidth = 2;
  ctx.fillStyle = "#78716c";
  ctx.font = `600 20px ${FONT}`;
  for (const minute of hours) {
    const y = yFor(minute);
    ctx.beginPath();
    ctx.moveTo(gridX, y);
    ctx.lineTo(gridX + gridW, y);
    ctx.stroke();
    ctx.fillText(formatMinutes(minute), panelX + 28, y - 12);
  }

  days.forEach((day, dayIndex) => {
    for (const block of layoutDay(courses, day)) {
      const rawY = yFor(block.start);
      const rawBottom = yFor(block.end);
      const x = gridX + dayIndex * columnW + 6 + (block.col * (columnW - 12)) / block.cols;
      const width = Math.max(36, (columnW - 12) / block.cols - 8);
      const y = rawY + 4;
      const height = Math.max(36, rawBottom - rawY - 8);
      ctx.fillStyle = block.color;
      roundRect(ctx, x, y, width, height, 16);
      ctx.fill();
      ctx.save();
      roundRect(ctx, x + 8, y + 8, Math.max(8, width - 16), Math.max(8, height - 16), 8);
      ctx.clip();
      ctx.fillStyle = "#ffffff";
      const nameSize = width < 100 ? 16 : 20;
      ctx.font = `700 ${nameSize}px ${FONT}`;
      const nameLines = wrapText(ctx, block.name, width - 20, height > 96 ? 2 : 1);
      nameLines.forEach((line, lineIndex) => {
        ctx.fillText(line, x + 12, y + 12 + lineIndex * (nameSize + 4));
      });
      const timeY = y + 16 + nameLines.length * (nameSize + 4);
      if (timeY + 18 < y + height) {
        ctx.font = `500 16px ${FONT}`;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillText(fitText(ctx, `${block.startLabel}–${block.endLabel}`, width - 20), x + 12, timeY);
      }
      ctx.restore();
    }
  });

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 36px ${FONT}`;
  const footer = fitText(ctx, labels.footer, 680);
  ctx.fillText(footer, 72, 1688);

  try {
    const qr = await loadQrImage();
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, 792, 1636, 216, 216, 28);
    ctx.fill();
    ctx.drawImage(qr, 808, 1652, 184, 184);
  } catch {
    // The schedule card is still useful if the QR image fails to load.
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Could not export share card."))), "image/png");
  });
  return blob;
}
