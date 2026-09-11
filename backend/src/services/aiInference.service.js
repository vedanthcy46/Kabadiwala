import { ApiError } from '../utils/ApiError.js';
import { getActiveModel } from './ai.service.js';

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
 * When no endpoint is configured we run the continuous-learning centroid + feature
 * model trained on human-validated lots in ai_feedback.
 */

const CATEGORY_IDS = ['CRT', 'LCD', 'PCB', 'Cable', 'Battery', 'Motor', 'Plastic'];

const PROVIDER = process.env.AI_CLASSIFIER_PROVIDER || 'heuristic'; // heuristic | cloud | off
const CLOUD_ENDPOINT = process.env.AI_CLASSIFY_ENDPOINT || '';

// ── Heuristic feature scorer (mirror of frontend/src/services/classification/analyze.js)
// Each rule: [feature, min, max, weight].

function fitRange(v, min, max) {
  if (v == null || Number.isNaN(Number(v))) return 0;
  const n = Number(v);
  if (min != null && n < min) return Math.max(0, 1 - (min - n) * 5);
  if (max != null && n > max) return Math.max(0, 1 - (n - max) * 5);
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

function centroidProximity(features, centroid) {
  if (!centroid) return 0.5;
  let dist = 0;
  const weights = { green: 3, edge: 3, copper: 2.5, blue: 1.5, red: 1.5, neutral: 2, meanLum: 1.5, meanSat: 1.5, darkFrac: 2 };
  let wSum = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (features[k] != null && centroid[k] != null) {
      dist += Math.pow(Number(features[k]) - Number(centroid[k]), 2) * w;
      wSum += w;
    }
  }
  const weightedDist = wSum ? Math.sqrt(dist / wSum) : 0.5;
  return Math.exp(-weightedDist * 3.5);
}

function rankFeatures(features) {
  const model = getActiveModel();
  const raw = {};

  for (const id of CATEGORY_IDS) {
    const ruleFit = categoryFit(features, RULES[id]);
    const centroid = model?.centroids?.[id];
    const learnedFit = centroid ? centroidProximity(features, centroid) : ruleFit;

    // Weight 60% domain rule fit + 40% learned sample proximity from human feedback
    raw[id] = (0.60 * ruleFit + 0.40 * learnedFit);
  }

  const sorted = Object.entries(raw).sort((a, b) => b[1] - a[1]);
  const topCategory = sorted[0][0];
  const topFit = sorted[0][1];
  const secondFit = sorted[1] ? sorted[1][1] : 0;
  const spread = Math.max(0, topFit - secondFit);
  const prior = model?.accuracyPriors?.[topCategory] ?? 0.82;
  
  // Truly continuous calibrated confidence:
  // Combines:
  // 1) base feature fit (how well features match this category)
  // 2) learned empirical prior (how accurate the model has been on this category)
  // 3) margin of victory (spread over the runner-up category)
  // 4) signal strength penalty if spread is negligible (ambiguity)
  const spreadBonus = spread > 0 ? Math.tanh(spread * 3.0) * 0.16 : 0;
  const rawConf = (topFit * 0.70 + prior * 0.30) + spreadBonus;
  
  // Normalization between 0.35 (very ambiguous/noisy) and 0.96 (crystal clear)
  const topConfidence = Math.min(0.96, Math.max(0.35, Math.round(rawConf * 1000) / 1000));

  const ranked = sorted.map(([category, fit], idx) => {
    let conf;
    if (idx === 0) {
      conf = topConfidence;
    } else {
      const relDiff = (topFit - fit) * 0.50;
      conf = Math.max(0.08, Math.round((topConfidence - relDiff) * 1000) / 1000);
    }
    return { category, confidence: conf };
  });

  return { ranked, model };
}

function toVerdict(confidence, spread) {
  if (confidence >= 0.75 && spread >= 0.12) return 'high';
  if (confidence >= 0.54) return 'medium';
  return 'low';
}

function heuristicClassify(features) {
  if (!features || typeof features !== 'object') {
    throw new ApiError(400, 'features object is required when an external model endpoint is not configured');
  }
  const { ranked, model } = rankFeatures(features);
  const top = ranked[0];
  const second = ranked[1];
  const spread = Number(top.confidence) - (Number(second?.confidence) || 0);
  const verdict = toVerdict(top.confidence, spread);

  let reason = '';
  if (verdict === 'high') {
    reason = `Strong visual features matching ${top.category}. Model ${model?.version || 'v1.0'} (${Math.round((model?.accuracy_pct || 75))}% historical validation).`;
  } else if (verdict === 'medium') {
    reason = `Moderate match for ${top.category}. Please verify subcategory before submitting.`;
  } else {
    reason = `Low confidence classification (${Math.round(top.confidence * 100)}%). Please verify material type manually.`;
  }

  return {
    category: top.category,
    confidence: top.confidence,
    verdict,
    reason,
    modelVersion: model?.version || 'v1.0-base',
    candidates: ranked.slice(0, 3),
    features,
    provider: 'heuristic-learned-server',
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