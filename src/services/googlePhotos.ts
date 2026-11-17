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
    throw new Error(`Failed to create Google Photos Picker session (HTTP ${res.status}): ${errText}`);
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
    onProgress?.('Waiting for you to finish selecting photos in the Google Photos window...');
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Timed out waiting for Google Photos Picker selection');
}

export async function listPickedMediaItems(
  sessionId: string,
  accessToken: string,
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
  const expiresAt = Date.now() + 55 * 60 * 1000; // 55 mins safety margin for 60m baseUrl

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    const mf = item.mediaFile;
    if (!mf?.baseUrl) continue;

    onProgress?.(`Loading photo ${i + 1} of ${rawItems.length}...`);

    try {
      const { displayUrl, thumbDataUrl, width, height } = await fetchDisplayAndCompactThumb(
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
        displayUrl,
        baseUrl: mf.baseUrl,
        baseUrlExpiresAt: expiresAt,
      });
    } catch {
      // Skip items that fail to load (e.g. unsupported video)
    }
  }

  return candidates;
}

async function fetchDisplayAndCompactThumb(
  baseUrl: string,
  accessToken: string,
  metaW?: number,
  metaH?: number
): Promise<{ displayUrl: string; thumbDataUrl: string; width: number; height: number }> {
  // Fetch a medium-high resolution display image for smooth mobile swiping
  const res = await fetch(`${baseUrl}=w1280-h1280`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Image fetch failed (${res.status})`);
  }
  const blob = await res.blob();
  const displayUrl = URL.createObjectURL(blob);

  const { thumbDataUrl, naturalW, naturalH } = await createCompactThumbDataUrl(displayUrl);
  return {
    displayUrl,
    thumbDataUrl,
    width: metaW || naturalW || 1600,
    height: metaH || naturalH || 1200,
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
      const scale = Math.min(1, maxDim / Math.max(nw, nh));
      const tw = Math.max(1, Math.round(nw * scale));
      const th = Math.max(1, Math.round(nh * scale));

      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, tw, th);
      // Use WebP (with JPEG fallback) at 0.65 quality (~8-12 KB for Firestore document)
      let thumbDataUrl = canvas.toDataURL('image/webp', 0.65);
      if (!thumbDataUrl.startsWith('data:image/webp')) {
        thumbDataUrl = canvas.toDataURL('image/jpeg', 0.65);
      }
      resolve({ thumbDataUrl, naturalW: nw, naturalH: nh });
    };
    img.onerror = () => reject(new Error('Could not decode image for thumbnail'));
    img.src = imageSrc;
  });
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
