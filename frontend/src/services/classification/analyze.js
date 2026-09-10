import { classifyAi } from '../../api/client';

const CATEGORY_IDS = ['CRT', 'LCD', 'PCB', 'Cable', 'Battery', 'Motor', 'Plastic'];

const SAMPLE_SIZE = 64;

function decodeImage(image, maxSize = 512) {
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.max(1, Math.round(image.naturalWidth * scale));
  const h = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  const step = Math.max(1, Math.round(w / SAMPLE_SIZE));
  const sw = Math.floor(w / step);
  const sh = Math.floor(h / step);
  const data = ctx.getImageData(0, 0, sw * step, sh * step).data;
  const pixels = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const idx = (y * step * w + x * step) * 4;
      pixels.push({
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2],
      });
    }
  }
  return pixels;
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let s = 0;
  let h = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return { h, s, l };
}

function luminance({ r, g, b }) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function collectFeatures(pixels) {
  const n = pixels.length;
  let lumSum = 0;
  let satSum = 0;
  let darkCount = 0;
  let brightCount = 0;
  const hueBins = { green: 0, blue: 0, copper: 0, red: 0, neutral: 0, purple: 0, yellow: 0 };
  const satValues = [];

  for (let i = 0; i < n; i++) {
    const { h, s, l } = rgbToHsl(pixels[i]);
    lumSum += l;
    satSum += s;
    satValues.push(s);
    if (l < 0.22) darkCount++;
    if (l > 0.8) brightCount++;

    if (s < 0.15) {
      hueBins.neutral++; // Grey / silver / metallic / black
    } else if (h >= 15 && h < 45) {
      hueBins.copper++; // Copper / orange / bronze (windings, bare wire)
    } else if (h >= 45 && h < 70) {
      hueBins.yellow++; // Yellow
    } else if (h >= 70 && h < 165) {
      hueBins.green++; // Circuit green / solder mask
    } else if (h >= 165 && h < 260) {
      hueBins.blue++; // Blue / cyan
    } else if (h >= 260 && h < 330) {
      hueBins.purple++; // Violet / magenta
    } else {
      hueBins.red++; // Red
    }
  }

  satValues.sort((a, b) => a - b);
  const q75 = satValues[Math.floor(n * 0.75)] || 0;

  let edgeSum = 0;
  for (let y = 1; y < SAMPLE_SIZE; y++) {
    for (let x = 1; x < SAMPLE_SIZE; x++) {
      if ((y * SAMPLE_SIZE + x) >= n) continue;
      const cur = pixels[y * SAMPLE_SIZE + x];
      const up = pixels[(y - 1) * SAMPLE_SIZE + x];
      const left = pixels[y * SAMPLE_SIZE + (x - 1)];
      const dl = Math.abs(luminance(cur) - luminance(up));
      const dr = Math.abs(luminance(cur) - luminance(left));
      edgeSum += Math.max(dl, dr);
    }
  }
  edgeSum /= Math.max(1, n);

  const meanSat = satSum / n;
  const variance = satValues.length
    ? satValues.reduce((acc, v) => acc + (v - meanSat) ** 2, 0) / satValues.length
    : 0;

  const coloredPixels = Math.max(1, n - hueBins.neutral);
  const hueRatios = {
    green: hueBins.green / coloredPixels,
    blue: hueBins.blue / coloredPixels,
    copper: hueBins.copper / coloredPixels,
    red: hueBins.red / coloredPixels,
    yellow: hueBins.yellow / coloredPixels,
    purple: hueBins.purple / coloredPixels,
    neutral: hueBins.neutral / n,
  };

  const meanLum = lumSum / n;

  return {
    meanLum,
    meanSat,
    satVar: Math.sqrt(variance),
    edge: edgeSum,
    darkFrac: darkCount / n,
    brightFrac: brightCount / n,
    q75,
    ...hueRatios,
  };
}

function fitRange(v, min, max) {
  if (v == null || Number.isNaN(Number(v))) return 0;
  const val = Number(v);
  if (min != null && val < min) {
    return Math.max(0, 1 - (min - val) * 5);
  }
  if (max != null && val > max) {
    return Math.max(0, 1 - (val - max) * 5);
  }
  return 1;
}

function categoryFit(f, rules) {
  let total = 0;
  let wSum = 0;
  for (const rule of rules) {
    const weight = rule[3] ?? 1;
    total += fitRange(f[rule[0]], rule[1], rule[2]) * weight;
    wSum += weight;
  }
  return wSum ? total / wSum : 0;
}

// Calibrated rules emphasizing discriminating features:
const RULES = {
  CRT: [
    ['darkFrac', 0.35, null, 3],
    ['meanLum', null, 0.35, 2],
    ['meanSat', null, 0.18, 1.5],
    ['neutral', 0.35, null, 1.5],
    ['edge', null, 0.18, 1.5],
  ],
  LCD: [
    ['edge', null, 0.14, 3],
    ['darkFrac', 0.25, 0.85, 2.5],
    ['meanLum', 0.12, 0.45, 2],
    ['green', null, 0.15, 2],
    ['neutral', 0.15, 0.55, 1.5],
  ],
  PCB: [
    ['green', 0.14, null, 4],
    ['edge', 0.14, null, 3],
    ['copper', 0.02, null, 1.5],
    ['blue', null, 0.35, 1.5],
  ],
  Cable: [
    ['satVar', 0.14, null, 4],
    ['edge', 0.14, null, 2.5],
    ['meanSat', 0.18, null, 2],
    ['green', null, 0.22, 3],
  ],
  Battery: [
    ['neutral', 0.48, null, 4],
    ['meanSat', null, 0.28, 2],
    ['green', null, 0.12, 2.5],
    ['copper', null, 0.08, 2],
    ['edge', 0.04, 0.28, 1.5],
  ],
  Motor: [
    ['copper', 0.06, null, 4.5],
    ['neutral', 0.20, null, 2.5],
    ['edge', 0.12, null, 2],
    ['green', null, 0.18, 2.5],
  ],
  Plastic: [
    ['edge', null, 0.13, 4],
    ['meanSat', 0.04, 0.50, 2],
    ['copper', null, 0.05, 3],
    ['green', null, 0.20, 2.5],
  ],
};

function classifyFeatures(f) {
  const raw = {};
  for (const id of CATEGORY_IDS) {
    raw[id] = categoryFit(f, RULES[id]);
  }

  const sorted = Object.entries(raw).sort((a, b) => b[1] - a[1]);
  const topCategory = sorted[0][0];
  const topFit = sorted[0][1];
  const secondFit = sorted[1] ? sorted[1][1] : 0;
  const spread = Math.max(0, topFit - secondFit);

  const PRIORS = {
    PCB: 0.85,
    Battery: 0.80,
    Cable: 0.78,
    LCD: 0.82,
    CRT: 0.75,
    Motor: 0.80,
    Plastic: 0.74,
  };
  const prior = PRIORS[topCategory] ?? 0.82;
  const base = topFit * prior;

  // Calibrated dynamic confidence (sharp difference between clear and ambiguous):
  let topConfidence;
  if (topFit >= 0.75 && spread >= 0.15) {
    topConfidence = Math.min(0.94, Math.round((base + spread * 0.22) * 1000) / 1000);
  } else if (topFit >= 0.55 && spread >= 0.08) {
    topConfidence = Math.min(0.78, Math.max(0.55, Math.round((base + spread * 0.15) * 1000) / 1000));
  } else {
    topConfidence = Math.max(0.36, Math.min(0.52, Math.round((topFit * 0.72) * 1000) / 1000));
  }

  const ranked = sorted.map(([category, fit], idx) => {
    let conf;
    if (idx === 0) {
      conf = topConfidence;
    } else {
      const relDiff = (topFit - fit) * 0.35;
      conf = Math.max(0.12, Math.round((topConfidence - relDiff) * 1000) / 1000);
    }
    return { category, confidence: conf };
  });

  return ranked;
}

export function classifyPixels(image, maxSize = 512) {
  const pixels = decodeImage(image, maxSize);
  const f = collectFeatures(pixels);

  const ranked = classifyFeatures(f);

  const top = ranked[0];
  const second = ranked[1];
  const spread = top.confidence - (second?.confidence ?? 0);

  let verdict = 'low';
  if (top.confidence >= 0.75 && spread >= 0.12) verdict = 'high';
  else if (top.confidence >= 0.54) verdict = 'medium';
  else verdict = 'low';

  let reason = '';
  if (verdict === 'high') {
    reason = `Clear visual features detected matching ${top.category} profiles.`;
  } else if (verdict === 'medium') {
    reason = `Moderate match for ${top.category}. Please verify before submitting.`;
  } else {
    reason = `Low confidence classification (${Math.round(top.confidence * 100)}%). Please verify material type manually.`;
  }

  return {
    category: top.category,
    confidence: top.confidence,
    verdict,
    reason,
    candidates: ranked.slice(0, 3),
    features: f,
  };
}

export async function classifyFile(file, maxSize = 512) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    const local = classifyPixels(image, maxSize);

    // Continuous learning: Send extracted features to backend learned model
    // which incorporates live centroids & empirical accuracy priors from human feedback
    try {
      const serverRes = await classifyAi({ features: local.features });
      if (serverRes?.data?.category) {
        return {
          ...serverRes.data,
          features: local.features,
        };
      }
    } catch {
      // Offline fallback: Use locally computed result
    }

    return local;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export { CATEGORY_IDS };
