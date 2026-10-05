export const MAX_IMAGE_EDGE = 1600;
export const JPEG_QUALITY = 0.85;

export type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function fittedSize(width: number, height: number) {
  const longest = Math.max(width, height);
  if (longest <= MAX_IMAGE_EDGE) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = MAX_IMAGE_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not compress image."))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

async function loadImage(file: Blob) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not read image."));
      image.src = url;
    });
    return { image, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function compressScheduleImage(file: Blob, source?: PixelRect) {
  const { image, url } = await loadImage(file);
  try {
    const crop = source ?? {
      x: 0,
      y: 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    const width = Math.max(1, Math.min(image.naturalWidth - crop.x, crop.width));
    const height = Math.max(1, Math.min(image.naturalHeight - crop.y, crop.height));
    const size = fittedSize(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not compress image.");
    context.drawImage(
      image,
      Math.max(0, crop.x),
      Math.max(0, crop.y),
      width,
      height,
      0,
      0,
      size.width,
      size.height,
    );
    const blob = await canvasToJpeg(canvas);
    const baseName = file instanceof File ? file.name.replace(/\.[^.]+$/, "") : "schedule";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function percentCropToPixels(
  crop: { x: number; y: number; width: number; height: number },
  naturalWidth: number,
  naturalHeight: number,
): PixelRect {
  return {
    x: (crop.x / 100) * naturalWidth,
    y: (crop.y / 100) * naturalHeight,
    width: (crop.width / 100) * naturalWidth,
    height: (crop.height / 100) * naturalHeight,
  };
}
