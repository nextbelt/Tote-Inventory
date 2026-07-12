// Client-side image compression so iPhone photos (3–10 MB) become fast,
// small uploads (~100–300 KB) before they ever leave the device.

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the image."));
    };
    img.src = url;
  });
}

/**
 * Downscale + re-encode an image file as JPEG. GIFs (animations) and files
 * that fail to decode are returned unchanged.
 * @returns {Promise<File>}
 */
export async function compressImage(file) {
  if (file.type === "image/gif") return file;

  let img, url;
  try {
    ({ img, url } = await loadImage(file));
  } catch {
    return file; // undecodable — let the caller's validation handle it
  }

  try {
    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight)
    );
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob) return file;

    // Only keep the compressed version when it actually helps
    if (blob.size >= file.size && scale === 1) return file;

    const baseName = (file.name || "photo").replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
