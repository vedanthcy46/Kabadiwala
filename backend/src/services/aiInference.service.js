import { ApiError } from '../utils/ApiError.js';

/**
 * Pluggable AI inference for material classification (SIH26229).
 *
 * The production story: a MobileNetV3 / EfficientNet-Lite classifier is trained
 * on the exported ai_feedback dataset (see scripts/export_training_dataset.js),
 * converted to TF Lite / ONNX, and served behind an HTTP endpoint. Set:
 *
 *   AI_CLASSIFIER_PROVIDER=cloud
 *   AI_CLASSIFY_ENDPOINT=https://your-model-host/v1/classify
 *
 * When no endpoint is configured we fall back to the same lightweight heuristic
 * the collector app runs on-device, so the endpoint always answers with a
 * consistent { category, confidence, verdict, candidates } shape.
 */

const CATEGORY_IDS = ['CRT', 'LCD', 'PCB', 'Cable', 'Battery', 'Motor', 'Plastic'];

const PROVIDER = process.env.AI_CLASSIFIER_PROVIDER || 'heuristic'; // heuristic | cloud | off
const CLOUD_ENDPOINT = process.env.AI_CLASSIFY_ENDPOINT || '';

// ── Heuristic feature scorer (mirror of frontend/src/services/classification/analyze.js)
// Each rule: [feature, min, max, weight].

function fitRange(v, min, max) {
  if (v == null || Number.isNaN(Number(v))) return 0;
  const n = Number(v);
  if (min != null && n < min) return Math.max(0, 1 - (min - n) * 3);
  if (max != null && n > max) return Math.max(0, 1 - (n - max) * 3);
  return 1;
}

function categoryFit(f, rules) {
  let total = 0;
  let wSum = 0;
  for (const [feature, min, max, weight] of rules) {
    const w = weight ?? 1;
    total += fitRange(f[feature], min, max) * w;
    wSum += w;
  }
  return wSum ? total / wSum : 0;
}

const RULES = {
  CRT: [
    ['darkFrac', 0.35, null, 3],
    ['meanLum', null, 0.4, 1.5],
    ['meanSat', null, 0.2, 1.5],
    ['purple', 0.03, null, 1],
  ],
  LCD: [
    ['edge', null, 0.12, 2.5],
    ['meanLum', 0.1, 0.5, 1],
    ['meanSat', null, 0.28, 1],
    ['green', null, 0.3, 1],
  ],
  PCB: [
    ['green', 0.18, null, 3],
    ['edge', 0.18, null, 2.5],
    ['copper', 0.03, null, 1.5],
    ['blue', null, 0.4, 1],
  ],
  Cable: [
    ['satVar', 0.14, null, 5],
    ['meanSat', 0.2, null, 2],
    ['edge', 0.16, null, 1.5],
    ['red', 0.03, null, 1.5],
    ['green', 0.02, 0.4, 0.5],
    ['blue', 0.02, 0.4, 0.5],
  ],
  Battery: [
    ['neutral', 0.55, null, 3],
    ['meanSat', null, 0.3, 1.5],
    ['meanLum', 0.28, 0.72, 1],
    ['edge', 0.05, 0.35, 1],
    ['copper', null, 0.1, 1.5],
  ],
  Motor: [
    ['copper', 0.08, null, 3],
    ['edge', 0.18, null, 2],
    ['neutral', 0.2, null, 1],
    ['meanLum', 0.3, 0.75, 1],
  ],
  Plastic: [
    ['edge', null, 0.16, 3],
    ['meanSat', 0.06, 0.6, 1.5],
    ['copper', null, 0.12, 1],
    ['green', null, 0.3, 1],
  ],
};

const MAGNIFY = 6;

function softMax(scores) {
  const exp = Object.entries(scores).map(([k, v]) => [k, Math.exp(v)]);
  const sum = exp.reduce((acc, [, v]) => acc + v, 0) || 1;
  return Object.fromEntries(exp.map(([k, v]) => [k, v / sum]));
}

function rankFeatures(features) {
  const raw = {};
  for (const id of CATEGORY_IDS) {
    raw[id] = Math.pow(categoryFit(features, RULES[id]), MAGNIFY);
  }
  const probs = softMax(raw);
  return Object.entries(probs)
    .sort((a, b) => b[1] - a[1])
    .map(([category, p]) => ({
      category,
      confidence: Math.round(p * 1000) / 1000,
    }));
}

function toVerdict(confidence, spread) {
  if (confidence >= 0.55 && spread >= 0.2) return 'high';
  if (confidence >= 0.4 && spread >= 0.12) return 'medium';
  return 'low';
}

function heuristicClassify(features) {
  if (!features || typeof features !== 'object') {
    throw new ApiError(400, 'features object is required when an external model endpoint is not configured');
  }
  const ranked = rankFeatures(features);
  const top = ranked[0];
  const spread = Number(top.confidence) - (ranked[1]?.confidence ?? 0);
  return {
    category: top.category,
    confidence: top.confidence,
    verdict: toVerdict(top.confidence, spread),
    candidates: ranked.slice(0, 3),
    features,
    provider: 'heuristic-server',
  };
}

async function cloudClassify(imageUrl) {
  if (!CLOUD_ENDPOINT) {
    throw new ApiError(400, 'AI_CLASSIFY_ENDPOINT is not configured');
  }
  const res = await fetch(CLOUD_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new ApiError(502, `Model endpoint returned ${res.status}`);
  }
  const data = await res.json();
  const prediction = data?.prediction || data?.data || data;
  const category = prediction?.category || prediction?.label;
  const confidence = Number(prediction?.confidence ?? prediction?.probability ?? 0);
  if (!category) throw new ApiError(502, 'Model endpoint returned no category');
  const ranked = [
    {
      category,
      confidence: Math.round(confidence * 1000) / 1000,
      ...(prediction?.candidates ? { candidates: prediction.candidates } : {}),
    },
  ];
  return {
    category,
    confidence: ranked[0].confidence,
    verdict: toVerdict(ranked[0].confidence, 0),
    candidates: (prediction?.candidates || ranked).slice(0, 3),
    features: prediction?.features ?? null,
    provider: 'cloud',
  };
}

/**
 * Classify a material category from an image URL (cloud model) or a pre-computed
 * feature vector (heuristic). Both return the canonical prediction shape.
 */
export async function classify({ imageUrl, features }) {
  if (PROVIDER === 'off') {
    throw new ApiError(503, 'AI classification is disabled (AI_CLASSIFIER_PROVIDER=off)');
  }
  if (PROVIDER === 'cloud') {
    if (!imageUrl) throw new ApiError(400, 'imageUrl is required when AI_CLASSIFIER_PROVIDER=cloud');
    return cloudClassify(imageUrl);
  }
  return heuristicClassify(features);
}

export { CATEGORY_IDS };