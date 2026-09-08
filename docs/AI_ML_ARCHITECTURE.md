# Kabadiwala Connect — AI/ML Architecture (SIH26229)

This document describes the four AI components built into Kabadiwala Connect
and how each one consumes the problem-statement datasets (image, category,
weight, location, historical price, transaction data). The goal is a real,
explainable AI pipeline — **identify → estimate → recommend → trace → audit** —
not a decorative bot.

```
                        COLLECTOR
                            │  📷 photo + weight + location
                            ▼
        ┌───────────────────────────────────────┐
        │  1. MATERIAL CLASSIFICATION            │  on-device heuristic today;
        │     (image → category + confidence)    │  pluggable MobileNet / TFLite
        └───────────────────┬───────────────────┘
                            │  human confirm / correct  →  ai_feedback dataset
                            ▼
        ┌───────────────────────────────────────┐
        │  2. VALUE ESTIMATION                   │  weighted moving average of
        │     (category + weight + location)     │  historical prices (₹ range)
        └───────────────────┬───────────────────┘
                            ▼
        ┌───────────────────────────────────────┐
        │  3. RECYCLER RECOMMENDATION            │  suitability score 0–100
        │     (price + distance + reliability…)  │  (explainable breadkdown)
        └───────────────────┬───────────────────┘
                            ▼
                          QR lot → handover → payment
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  4. TRANSACTION ANOMALY DETECTION      │  z-score vs category mean +
        │                                        │  market-range guardrails
        └───────────────────┬───────────────────┘
                            ▼
                   admin review / traceability
```

---

## 1. Material Classification

| Aspect | Implementation |
|---|---|
| Where | `frontend/src/services/classification/analyze.js` (on-device, offline-safe) |
| Classes | `CRT, LCD, PCB, Cable, Battery, Motor, Plastic` (extensible to sub-species later) |
| Method | HSL + edge feature extraction → per-class rule fit → softmax over `MAGNIFY=6` |
| Output | `{ category, confidence, verdict (high/medium/low), candidates[], features[] }` |
| Server twin | `backend/src/services/aiInference.service.js` — identical rules so the API can re-score a client feature vector |

### Production model path (pluggable)

A trained model (MobileNetV3 / EfficientNet-Lite → TF Lite / ONNX) can replace
the heuristic without changing the API contract:

```env
AI_CLASSIFIER_PROVIDER=cloud
AI_CLASSIFY_ENDPOINT=https://your-model-host/v1/classify
```

`POST /v1/ai/classify` accepts `{ imageUrl }` (cloud) or `{ features }`
(heuristic) and always returns the canonical prediction shape above.

### Human-in-the-loop validation

AI is an **assist**, never an override. Every prediction is sent to
`POST /v1/ai/feedback`; the collector can **confirm** (outcome `accepted`) or
**change** (outcome `corrected`) the material. That decision is the training
label.

---

## 2. Value Estimation

- Service: `backend/src/services/valuation.service.js`
- Model: recency-weighted average of the 10 most recent `prices` rows for
  `(category, location)` — newer rows weigh more; range = span of
  `market_range_low/high` in the window.
- Output: `estimated_value`, `unit_price`, `market_range_low/high`, `price_samples`.
- Guardrail: the estimate is a *market reference*, never the final price —
  the recycler quote keeps the final say (fairness).
- Related: `/v1/prices/trends` for published trend charts.

## 3. Recycler Recommendation (Suitability Score)

- Service: `backend/src/services/recycler.service.js`
- `GET /v1/recyclers/match?category&lat&lng&maxDistanceKm`
- Scores **authorized** recyclers that accept the material, then ranks by:

| Factor | Weight | Source |
|---|---|---|
| Price (offered rate, min–max normalized) | 32% | `prices.buying_price` per recycler |
| Distance (inverted haversine) | 26% | `recyclers.latitude/longitude` |
| Reliability (share of completed transactions) | 22% | `transactions` history per recycler |
| Pickup availability (daily > weekly > on-demand) | 12% | `recyclers.pickup_availability` |
| Material compatibility (guaranteed by filter) | 8% | `materials_accepted` |

- Response: `suitability` (0–100, higher = better) plus the five component
  scores (`score_price`, `score_distance`, `score_pickup`,
  `score_reliability`, `score_material`) so the recommendation is
  **explainable** — the collector UI renders each factor as a chip.
- Hybrid note: with limited history the reliability term defaults to 0.6; as
  transactions accumulate it becomes data-driven (the ML evolution path).

## 4. Transaction Anomaly Detection

- Service: `backend/src/services/anomaly.service.js`
- `POST /v1/anomaly/check` and `GET /v1/anomaly`
- Detects:
  - **Statistical outliers** — unit price beyond ±2σ of the category mean
    (requires ≥ 5 samples; severity high >3σ, medium ≤3σ)
  - **Market-range violations** — below `market_range_low` (high severity) or
    above `market_range_high × 1.5`
- Connected to traceability: a flagged price triggers an admin review entry in
  the immutable audit log rather than silently changing the transaction.

---

## AI Dataset Lifecycle (the requirement: *generated, stored, validated, updated, used*)

### Generated
Every image classification + collector decision writes a row to `ai_feedback`
(`backend/src/services/ai.service.js`). Columns: lot, collector,
`ai_predicted_category`, `ai_confidence`, `ai_verdict`, `ai_candidates`,
`ai_features`, `human_category`, `outcome`, `created_at`.

### Stored
- `ai_feedback` table — `backend/sql/06_ai_feedback.sql`
- Governance views — `backend/sql/08_ai_governance.sql`:
  - `v_ai_dataset_summary` — per-category counts + accuracy
  - `v_ai_dataset_trend` — monthly growth + accuracy (retraining cadence)
  - `v_ai_dataset_samples` — labelled rows joined to lot evidence
    (image ref, weight, condition, location)

### Validated
Only rows with `outcome IN ('accepted','corrected')` count as labelled.
Accuracy = `accepted / (accepted + corrected)` per category.

### Updated / Used
- REST endpoints (admin/dataset governance):
  - `GET /v1/ai/dataset/summary`
  - `GET /v1/ai/dataset/samples?outcome=&category=&limit=&offset=`
  - `GET /v1/ai/dataset/export` → CSV of validated samples
- CLI tooling:
  - `npm run export:ai-dataset` → `backend/data/ai/training_dataset.{csv,jsonl}` + `manifest.json`
  - `npm run eval:ai-dataset` → `backend/data/ai/evaluation_report.json` with
    retrain/no-retrain recommendation
- Admin UI: `/admin` → **AI Dataset** tab shows totals, per-category table,
  recent labelled rows, and the CSV export link.

**Stage 1→2 evolution:** the exported CSV/JSONL is the labelled input for
training a real MobileNet/EfficientNet classifier. Train (time-split, not
random split), convert to TF Lite, deploy behind `AI_CLASSIFY_ENDPOINT`, set
`AI_CLASSIFIER_PROVIDER=cloud`, and the app starts using the learned model
while the feedback loop keeps growing/validating the dataset.

---

## Where AI is deliberately NOT used

QR generation, GPS capture, timestamps, evidence photos and payment routing are
plain deterministic logic. Recycler *authorization* comes from verified
regulatory data (SPCB), never from a model — AI only ranks already-authorized
recyclers.

## Related files

```
backend/src/services/ai.service.js              feedback + dataset governance
backend/src/services/aiInference.service.js     pluggable classifier
backend/src/services/recycler.service.js        suitability scoring
backend/src/services/valuation.service.js       value estimation
backend/src/services/anomaly.service.js         anomaly detection
backend/sql/06_ai_feedback.sql                  feedback table
backend/sql/08_ai_governance.sql                governance views
backend/scripts/export_training_dataset.js      dataset export
backend/scripts/evaluate_training_dataset.js    dataset evaluation
backend/src/routes/v1/ai.route.js               /v1/ai/* endpoints
frontend/src/collector/MatchedRecyclers.jsx     suitability UI (score + breakdown)
frontend/src/pages/Admin.jsx                    AI Dataset governance tab
docs/DATASETS.md → backend/docs/DATASETS.md     dataset definitions & seeds
```