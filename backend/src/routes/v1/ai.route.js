import express from 'express';
import {
  recordAiFeedback, updateAiFeedback, getAiFeedbackStats,
  getAiDatasetSummary, getAiDatasetSamples, exportAiDatasetCsv,
  getActiveModel, trainModelFromFeedback,
} from '../../services/ai.service.js';
import { classify } from '../../services/aiInference.service.js';

const router = express.Router();

// POST /v1/ai/feedback — record a new CV prediction (called right after classification)
router.post('/feedback', async (req, res, next) => {
  try {
    const row = await recordAiFeedback(req.body);
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

// PATCH /v1/ai/feedback/:id — update with human outcome (accepted / corrected / dismissed)
router.patch('/feedback/:id', async (req, res, next) => {
  try {
    const row = await updateAiFeedback(Number(req.params.id), req.body);
    res.json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

// GET /v1/ai/stats — per-category accuracy summary (for admin / SIH dataset governance)
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await getAiFeedbackStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

// GET /v1/ai/model — inspect current continuous-learning model version, accuracy priors & centroids
router.get('/model', async (req, res, next) => {
  try {
    const model = getActiveModel();
    res.json({ success: true, data: model });
  } catch (err) {
    next(err);
  }
});

// POST /v1/ai/retrain — trigger full model retraining on all validated feedback samples
router.post('/retrain', async (req, res, next) => {
  try {
    const updatedModel = await trainModelFromFeedback();
    res.json({
      success: true,
      message: `Model successfully retrained on ${updatedModel.totalSamples} validated samples.`,
      data: updatedModel,
    });
  } catch (err) {
    next(err);
  }
});

// POST /v1/ai/classify
// Pluggable material classifier. With AI_CLASSIFIER_PROVIDER=cloud the image
// URL is sent to AI_CLASSIFY_ENDPOINT; otherwise a feature vector is scored with
// the same heuristic the app runs on-device. Body:
//   { imageUrl: string }  — required in cloud mode
//   { features: object }  — required in heuristic mode (client-extracted colors/edges)
router.post('/classify', async (req, res, next) => {
  try {
    const result = await classify(req.body || {});
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ── AI dataset governance ─────────────────────────────────────────────────────

// GET /v1/ai/dataset/summary — labelled-sample health: totals, per-category
// breakdown, and monthly accuracy trend (all back by v_ai_dataset_* views).
router.get('/dataset/summary', async (req, res, next) => {
  try {
    const data = await getAiDatasetSummary();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /v1/ai/dataset/samples?outcome=&category=&limit=&offset= — recent labelled rows.
router.get('/dataset/samples', async (req, res, next) => {
  try {
    const { outcome, category } = req.query;
    const data = await getAiDatasetSamples({
      outcome,
      category,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /v1/ai/dataset/export — CSV of validated samples (retraining input).
router.get('/dataset/export', async (req, res, next) => {
  try {
    const csv = await exportAiDatasetCsv();
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ai_training_dataset.csv"',
      })
      .send(csv);
  } catch (err) {
    next(err);
  }
});

export default router;