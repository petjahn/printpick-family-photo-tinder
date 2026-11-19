import { CandidatePhoto } from '../types';
import { createCompactThumbDataUrl } from './googlePhotos';
import { cacheFullResBlob } from './idbCache';

interface DemoItemSpec {
  id: string;
  filename: string;
  assetPath: string;
  createTime: string;
}

const DEMO_ITEMS: DemoItemSpec[] = [
  {
    id: 'sample_park_swings_01',
    filename: 'IMG_4821_Autumn_Swings.jpg',
    assetPath: './demo/park_swings.jpg',
    createTime: '2026-11-14T16:18:00Z',
  },
  {
    id: 'sample_park_blurry_02',
    filename: 'IMG_4822_Park_Blurry_Burst.jpg',
    assetPath: './demo/park_blurry_misfire.jpg',
    createTime: '2026-11-14T16:18:03Z',
  },
  {
    id: 'sample_kitchen_paint_03',
    filename: 'IMG_4859_Kitchen_Watercolors.jpg',
    assetPath: './demo/kitchen_painting.jpg',
    createTime: '2026-11-15T10:42:00Z',
  },
  {
    id: 'sample_rainboots_puddle_04',
    filename: 'IMG_4904_Rainboots_Splash.jpg',
    assetPath: './demo/rainboots_puddle.jpg',
    createTime: '2026-11-16T09:15:00Z',
  },
];

export async function generateDemoCandidates(): Promise<CandidatePhoto[]> {
  const results: CandidatePhoto[] = [];

  for (const spec of DEMO_ITEMS) {
    try {
      const res = await fetch(spec.assetPath);
      if (!res.ok) continue;
      const blob = await res.blob();
      await cacheFullResBlob(spec.id, blob);
      const displayUrl = URL.createObjectURL(blob);
      const { thumbDataUrl, naturalW, naturalH } = await createCompactThumbDataUrl(displayUrl, 240);

      results.push({
        id: spec.id,
        filename: spec.filename,
        mimeType: 'image/jpeg',
        createTime: spec.createTime,
        width: naturalW || 960,
        height: naturalH || 1280,
        thumbDataUrl,
        displayUrl,
        baseUrl: displayUrl,
        baseUrlExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });
    } catch {
      // ignore individual sample load failures
    }
  }

  return results;
}
