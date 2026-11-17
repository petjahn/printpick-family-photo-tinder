import { CandidatePhoto } from '../types';
import { createCompactThumbDataUrl } from './googlePhotos';
import { cacheFullResBlob } from './idbCache';

interface DemoSpec {
  id: string;
  filename: string;
  createTime: string;
  title: string;
  subtitle: string;
  palette: [string, string, string];
  blink?: boolean;
  blur?: number;
}

const DEMO_SPECS: DemoSpec[] = [
  {
    id: 'gphoto_demo_01',
    filename: 'PXL_20261114_101501_PARK_SWING_1.jpg',
    createTime: '2026-11-14T10:15:01Z',
    title: 'Leo & Maya on the Park Swings (Shot 1)',
    subtitle: 'Eyes closed + motion blur — try Swiping UP (↑) to Mark for Deletion!',
    palette: ['#1e3a5f', '#d97706', '#fef3c7'],
    blink: true,
    blur: 2.2,
  },
  {
    id: 'gphoto_demo_02',
    filename: 'PXL_20261114_101503_PARK_SWING_2.jpg',
    createTime: '2026-11-14T10:15:03Z',
    title: 'Leo & Maya on the Park Swings (Shot 2)',
    subtitle: 'Both kids smiling & sharp — try Swiping RIGHT (→) to Mark for Print!',
    palette: ['#1e3a5f', '#f59e0b', '#fef3c7'],
  },
  {
    id: 'gphoto_demo_03',
    filename: 'PXL_20261114_142010_WATERCOLOR.jpg',
    createTime: '2026-11-14T14:20:10Z',
    title: 'Kitchen Table Finger-Painting',
    subtitle: 'Holding up painted hands — Swipe RIGHT (→) to Print or LEFT (←) to Ignore',
    palette: ['#134e4a', '#10b981', '#ecfdf5'],
  },
  {
    id: 'gphoto_demo_04',
    filename: 'PXL_20261115_180511_BIRTHDAY_CAKE_1.jpg',
    createTime: '2026-11-15T18:05:11Z',
    title: '6th Birthday Candle Glow',
    subtitle: 'Big grin right before blowing out candles',
    palette: ['#3b0764', '#f97316', '#ffedd5'],
  },
  {
    id: 'gphoto_demo_05',
    filename: 'PXL_20261115_180514_BIRTHDAY_SMOKE.jpg',
    createTime: '2026-11-15T18:05:14Z',
    title: 'Smoke Plume & Accidental Thumb Over Lens',
    subtitle: 'Out of focus duplicate — great candidate to Swipe UP (↑) to Delete',
    palette: ['#450a0a', '#ef4444', '#fee2e2'],
    blink: true,
    blur: 2.8,
  },
  {
    id: 'gphoto_demo_06',
    filename: 'PXL_20261116_093000_RAINBOOTS_SPLASH.jpg',
    createTime: '2026-11-16T09:30:00Z',
    title: 'Yellow Rainboots Puddle Jump',
    subtitle: 'Mid-air splash frozen at 1/1000s',
    palette: ['#0f172a', '#eab308', '#fef9c3'],
  },
];

export async function generateDemoCandidates(): Promise<CandidatePhoto[]> {
  const results: CandidatePhoto[] = [];
  for (const spec of DEMO_SPECS) {
    const blob = await renderDemoBlob(spec);
    await cacheFullResBlob(spec.id, blob);
    const displayUrl = URL.createObjectURL(blob);
    const { thumbDataUrl } = await createCompactThumbDataUrl(displayUrl, 200);
    results.push({
      id: spec.id,
      filename: spec.filename,
      mimeType: 'image/jpeg',
      createTime: spec.createTime,
      width: 1600,
      height: 1200,
      thumbDataUrl,
      displayUrl,
      baseUrl: displayUrl,
      baseUrlExpiresAt: Date.now() + 60 * 60 * 1000,
    });
  }
  return results;
}

function renderDemoBlob(spec: DemoSpec): Promise<Blob> {
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = 960;
    c.height = 720;
    const ctx = c.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, c.width, c.height);
    grad.addColorStop(0, spec.palette[0]);
    grad.addColorStop(1, '#090d16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.save();
    for (let b = 0; b < 12; b++) {
      ctx.fillStyle = spec.palette[1] + '24';
      ctx.beginPath();
      ctx.arc(110 + ((b * 173) % 740), 90 + ((b * 137) % 500), 26 + (b % 4) * 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    if (spec.blur) {
      ctx.filter = `blur(${spec.blur}px)`;
    }
    drawKidAvatar(ctx, 370, 320, 86, '#fde68a', Boolean(spec.blink));
    drawKidAvatar(ctx, 590, 335, 76, '#fed7aa', Boolean(spec.blink));
    ctx.restore();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
    ctx.fillRect(0, c.height - 108, c.width, 108);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px Inter, system-ui, sans-serif';
    ctx.fillText(spec.title, 32, c.height - 62);

    ctx.fillStyle = spec.palette[2];
    ctx.font = '16px Inter, system-ui, sans-serif';
    ctx.fillText(spec.subtitle, 32, c.height - 28);

    c.toBlob((b) => resolve(b!), 'image/jpeg', 0.9);
  });
}

function drawKidAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  skin: string,
  blink: boolean
) {
  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 1.35, r * 1.15, r * 0.75, 0, Math.PI, 0);
  ctx.fill();

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#451a03';
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.15, r * 0.98, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();

  ctx.strokeStyle = '#1e293b';
  ctx.fillStyle = '#1e293b';
  ctx.lineWidth = 4;

  if (blink) {
    [-r * 0.34, r * 0.34].forEach((dx) => {
      ctx.beginPath();
      ctx.arc(cx + dx, cy - r * 0.1, r * 0.13, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    });
  } else {
    [-r * 0.34, r * 0.34].forEach((dx) => {
      ctx.beginPath();
      ctx.arc(cx + dx, cy - r * 0.1, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + dx - 3, cy - r * 0.14, r * 0.035, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e293b';
    });
  }

  ctx.beginPath();
  if (blink) {
    ctx.arc(cx, cy + r * 0.28, r * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
  } else {
    ctx.arc(cx, cy + r * 0.2, r * 0.35, 0.1 * Math.PI, 0.9 * Math.PI);
  }
  ctx.stroke();
}
