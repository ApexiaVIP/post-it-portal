/**
 * Browser side of uploading the Fact Find sheet (Guy, 22 Nov 2026). Phone
 * photos are shrunk to the size the AI reads them at (1568 pixels on the long
 * side) and sent as JPEG, so each page is well under the 4MB upload limit.
 * A PDF is sent as it is.
 */

const LONG_EDGE = 1568;

async function shrink(file: File): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`Couldn't open ${file.name}. Send it as a JPEG or PNG photo, or a PDF.`);
  }
  const scale = Math.min(1, LONG_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare photos. Try another browser.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  if (!blob) throw new Error(`Couldn't prepare ${file.name}.`);
  return blob;
}

/** Uploads one page to a draft check. Resolves to an error message, or null. */
export async function uploadPage(checkId: number, file: File): Promise<string | null> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  let body: Blob;
  try {
    body = isPdf ? file : await shrink(file);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  if (body.size > 4 * 1024 * 1024) return `${file.name} is larger than 4MB. Photograph the pages instead.`;
  const form = new FormData();
  form.append("file", body, isPdf ? file.name : file.name.replace(/\.[^.]+$/, "") + ".jpg");
  const r = await fetch(`/api/advice-check/${checkId}/pages`, { method: "POST", body: form });
  if (r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return (j as { error?: string }).error || `Upload failed (HTTP ${r.status}).`;
}
