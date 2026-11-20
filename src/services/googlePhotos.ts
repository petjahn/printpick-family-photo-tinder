import { CandidatePhoto } from '../types';
import { cacheFullResBlob } from './idbCache';

export interface PickerSessionResponse {
  id: string;
  pickerUri: string;
  mediaItemsSet?: boolean;
  pollingConfig?: {
    pollInterval?: string;
    timeoutIn?: string;
  };
}

interface PickedMediaItemRaw {
  id: string;
  createTime?: string;
  type?: string;
  mediaFile?: {
    baseUrl: string;
    mimeType?: string;
    filename?: string;
    mediaFileMetadata?: {
      width?: number;
      height?: number;
    };
  };
}

const PICKER_BASE = 'https://photospicker.googleapis.com/v1';

export async function createPickerSession(accessToken: string): Promise<PickerSessionResponse> {
  const res = await fetch(`${PICKER_BASE}/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Failed to create Google Photos Picker session (HTTP ${res.status}): ${errText}`
    );
  }
  return (await res.json()) as PickerSessionResponse;
}

export async function pollPickerSessionUntilReady(
  sessionId: string,
  accessToken: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal
): Promise<PickerSessionResponse> {
  const maxAttempts = 120; // up to ~6 minutes
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new Error('Google Photos selection cancelled');
    }
    const res = await fetch(`${PICKER_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    });
    if (!res.ok) {
      throw new Error(`Session check failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as PickerSessionResponse;
    if (data.mediaItemsSet) {
      return data;
    }
    onProgress?.('Select your photos in the Google Photos tab and tap Done...');
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error('Timed out waiting for Google Photos Picker selection');
}

export async function listPickedMediaItems(
  sessionId: string,
  accessToken: string,
  existingStatusById: Record<string, string>,
  onProgress?: (msg: string) => void
): Promise<CandidatePhoto[]> {
  const rawItems: PickedMediaItemRaw[] = [];
  let pageToken = '';

  do {
    const url = new URL(`${PICKER_BASE}/mediaItems`);
    url.searchParams.set('sessionId', sessionId);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to list picked media items (HTTP ${res.status})`);
    }
    const body = (await res.json()) as {
      mediaItems?: PickedMediaItemRaw[];
      nextPageToken?: string;
    };
    if (body.mediaItems) {
      rawItems.push(...body.mediaItems);
    }
    pageToken = body.nextPageToken || '';
  } while (pageToken);

  const candidates: CandidatePhoto[] = [];
  const expiresAt = Date.now() + 55 * 60 * 1000;
  const baseOrder = Date.now();

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    const mf = item.mediaFile;
    if (!mf?.baseUrl) continue;

    const existingStatus = existingStatusById[item.id];
    // If already swiped (shown or delete), skip downloading preview bytes altogether!
    if (existingStatus === 'shown' || existingStatus === 'delete' || existingStatus === 'printed') {
      continue;
    }

    onProgress?.(`Preparing photo ${i + 1} of ${rawItems.length} for cloud sync...`);

    try {
      const { displayUrl, previewDataUrl, thumbDataUrl, width, height } =
        await fetchDisplayPreviewAndThumb(
          item.id,
          mf.baseUrl,
          accessToken,
          mf.mediaFileMetadata?.width,
          mf.mediaFileMetadata?.height
        );

      candidates.push({
        id: item.id,
        filename: mf.filename || `GPHOTO_${item.id.slice(0, 8)}.jpg`,
        mimeType: mf.mimeType || 'image/jpeg',
        createTime: item.createTime || new Date().toISOString(),
        width,
        height,
        thumbDataUrl,
        previewDataUrl,
        displayUrl,
        baseUrl: mf.baseUrl,
        baseUrlExpiresAt: expiresAt,
        pickedOrder: baseOrder + i,
      });
    } catch {
      // Skip unsupported media (e.g. non-decodable raw video)
    }
  }

  return candidates;
}

async function fetchDisplayPreviewAndThumb(
  photoId: string,
  baseUrl: string,
  accessToken: string,
  metaW?: number,
  metaH?: number
): Promise<{
  displayUrl: string;
  previewDataUrl: string;
  thumbDataUrl: string;
  width: number;
  height: number;
}> {
  const res = await fetch(`${baseUrl}=w1280-h1280`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Image fetch failed (${res.status})`);
  }
  const blob = await res.blob();
  await cacheFullResBlob(photoId, blob);
  const displayUrl = URL.createObjectURL(blob);

  const { previewDataUrl, thumbDataUrl, naturalW, naturalH } =
    await createSyncPreviewAndCompactThumb(displayUrl);

  return {
    displayUrl,
    previewDataUrl,
    thumbDataUrl,
    width: metaW || naturalW || 1280,
    height: metaH || naturalH || 960,
  };
}

export function createCompactThumbDataUrl(
  imageSrc: string,
  maxDim = 220
): Promise<{ thumbDataUrl: string; naturalW: number; naturalH: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const nw = img.naturalWidth || 800;
      const nh = img.naturalHeight || 600;
      const thumbDataUrl = encodeResizedDataUrl(img, maxDim, 0.65);
      resolve({ thumbDataUrl, naturalW: nw, naturalH: nh });
    };
    img.onerror = () => reject(new Error('Could not decode image for thumbnail'));
    img.src = imageSrc;
  });
}

function createSyncPreviewAndCompactThumb(imageSrc: string): Promise<{
  previewDataUrl: string;
  thumbDataUrl: string;
  naturalW: number;
  naturalH: number;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const nw = img.naturalWidth || 800;
      const nh = img.naturalHeight || 600;

      // 1. Compact Admin grid thumbnail (~8-12 KB)
      const thumbDataUrl = encodeResizedDataUrl(img, 220, 0.65);

      // 2. Crisp mobile swipe preview (~55-80 KB WebP) synced to Firestore for other devices
      let previewDataUrl = encodeResizedDataUrl(img, 820, 0.72);
      // Safety guard: ensure preview string stays well below Firestore's 1 MB document limit
      if (previewDataUrl.length > 320_000) {
        previewDataUrl = encodeResizedDataUrl(img, 640, 0.6);
      }

      resolve({ previewDataUrl, thumbDataUrl, naturalW: nw, naturalH: nh });
    };
    img.onerror = () => reject(new Error('Could not decode image for cloud preview'));
    img.src = imageSrc;
  });
}

function encodeResizedDataUrl(img: HTMLImageElement, maxDim: number, quality: number): string {
  const nw = img.naturalWidth || 800;
  const nh = img.naturalHeight || 600;
  const scale = Math.min(1, maxDim / Math.max(nw, nh));
  const tw = Math.max(1, Math.round(nw * scale));
  const th = Math.max(1, Math.round(nh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0, tw, th);

  let dataUrl = canvas.toDataURL('image/webp', quality);
  if (!dataUrl.startsWith('data:image/webp')) {
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return dataUrl;
}

export async function fetchFullResPhotoBlob(
  photoId: string,
  baseUrl: string,
  accessToken: string
): Promise<Blob> {
  const res = await fetch(`${baseUrl}=d`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Full-res download failed (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  await cacheFullResBlob(photoId, blob);
  return blob;
}
