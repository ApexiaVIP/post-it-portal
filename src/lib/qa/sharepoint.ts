/**
 * Call recordings from Clearvolt's SharePoint (12 Oct 2026), read with
 * Microsoft Graph using an app registration that should be granted
 * access to that one site only (Sites.Selected).
 *
 * Env:
 *   QA_SP_TENANT_ID, QA_SP_CLIENT_ID, QA_SP_CLIENT_SECRET   app registration
 *   QA_SP_SITE_HOST    default clearvolt.sharepoint.com
 *   QA_SP_SITE_PATH    default "" (the root site)
 *   QA_SP_FOLDER       default Recordings/recordings (in Shared Documents)
 *   QA_SP_LOOKBACK_DAYS        default 21
 *   QA_MIN_RECORDING_BYTES     default 1000000 (skips no-answers / voicemails)
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const AUDIO = /\.(wav|mp3|m4a|ogg|opus|flac|wma|aac)$/i;

export function sharepointConfigured(): boolean {
  return !!(process.env.QA_SP_TENANT_ID && process.env.QA_SP_CLIENT_ID && process.env.QA_SP_CLIENT_SECRET);
}

async function token(): Promise<string> {
  const tenant = process.env.QA_SP_TENANT_ID;
  const body = new URLSearchParams({
    client_id: process.env.QA_SP_CLIENT_ID ?? "",
    client_secret: process.env.QA_SP_CLIENT_SECRET ?? "",
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: "POST", body });
  const j = await r.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`Microsoft sign-in failed: ${j.error_description?.split("\n")[0] ?? r.status}`);
  return j.access_token;
}

async function graph<T>(tok: string, url: string): Promise<T> {
  const r = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(`SharePoint ${r.status}: ${j.error?.message ?? "request failed"}`);
  }
  return r.json() as Promise<T>;
}

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { path?: string };
}

export interface FoundRecording {
  driveId: string;
  itemId: string;
  filename: string;
  folderPath: string | null;
  sizeBytes: number;
  mimeType: string | null;
  createdAt: string | null;
}

async function driveId(tok: string): Promise<string> {
  const host = process.env.QA_SP_SITE_HOST || "clearvolt.sharepoint.com";
  const path = (process.env.QA_SP_SITE_PATH || "").replace(/^\/+|\/+$/g, "");
  const site = await graph<{ id: string }>(tok, path ? `/sites/${host}:/${path}` : `/sites/${host}`);
  const drive = await graph<{ id: string }>(tok, `/sites/${site.id}/drive`);
  return drive.id;
}

/** Audio files in the recordings folder (and recent subfolders) created within the lookback window. */
export async function listRecordings(): Promise<{ driveId: string; files: FoundRecording[] }> {
  const tok = await token();
  const drive = await driveId(tok);
  const folder = (process.env.QA_SP_FOLDER || "Recordings/recordings").replace(/^\/+|\/+$/g, "");
  const lookbackMs = (Number(process.env.QA_SP_LOOKBACK_DAYS) || 21) * 86400000;
  const since = Date.now() - lookbackMs;
  const files: FoundRecording[] = [];

  async function walk(url: string, depth: number) {
    let next: string | null = url;
    while (next) {
      const page: { value: DriveItem[]; "@odata.nextLink"?: string } = await graph(tok, next);
      for (const it of page.value) {
        if (it.folder) {
          const touched = it.lastModifiedDateTime ? Date.parse(it.lastModifiedDateTime) : Date.now();
          if (depth < 4 && touched >= since) {
            await walk(`/drives/${drive}/items/${it.id}/children?$top=500`, depth + 1);
          }
          continue;
        }
        if (!it.file || !AUDIO.test(it.name)) continue;
        const created = it.createdDateTime ? Date.parse(it.createdDateTime) : Date.now();
        if (created < since) continue;
        files.push({
          driveId: drive,
          itemId: it.id,
          filename: it.name,
          folderPath: it.parentReference?.path?.replace(/^.*root:/, "") || null,
          sizeBytes: it.size ?? 0,
          mimeType: it.file.mimeType ?? null,
          createdAt: it.createdDateTime ?? null,
        });
      }
      next = page["@odata.nextLink"] ?? null;
    }
  }
  await walk(`/drives/${drive}/root:/${encodeURI(folder)}:/children?$top=500`, 0);
  return { driveId: drive, files };
}

export async function downloadRecording(driveId: string, itemId: string): Promise<Buffer> {
  const tok = await token();
  // Graph answers with a redirect to a pre-authorised download URL.
  const r = await fetch(`${GRAPH}/drives/${driveId}/items/${itemId}/content`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`SharePoint download failed (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Pull the adviser's extension, the client's number and the call time out
 * of a recording's file name. 3CX names vary by version, so this looks
 * for the parts rather than relying on one layout:
 *   extension  a 3-4 digit number that is a known adviser extension
 *   phone      a UK number (07..., 01..., 02..., +44 / 44...)
 *   time       yyyymmddHHMMSS, or yyyy-mm-dd with an HH-MM-SS time
 */
export function parseRecordingName(name: string, knownExtensions: Set<string>): {
  extension: string | null; phone: string | null; startedAt: string | null;
} {
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  const numbers = base.match(/\+?\d+/g) ?? [];

  const extension = numbers.find((n) => knownExtensions.has(n.replace(/^\+/, ""))) ?? null;

  let phone: string | null = null;
  for (const raw of numbers) {
    const n = raw.replace(/^\+/, "");
    if (/^44\d{10}$/.test(n)) { phone = `0${n.slice(2)}`; break; }
    if (/^0[1237]\d{8,9}$/.test(n)) { phone = n; break; }
  }

  let startedAt: string | null = null;
  const compact = base.match(/(20\d{2})(\d{2})(\d{2})[_\-T ]?(\d{2})(\d{2})(\d{2})/);
  const dashed = base.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})[_\-T ]+(\d{2})[-_.:](\d{2})[-_.:](\d{2})/);
  const m = compact ?? dashed;
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
    if (!Number.isNaN(Date.parse(iso))) startedAt = iso;
  }
  return { extension, phone, startedAt };
}
