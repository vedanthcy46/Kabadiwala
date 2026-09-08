import * as handoverService from '../services/handover.service.js';

export const createLot = async (req, res) => {
  const result = await handoverService.createLot(req.body);

  res.status(201).json({
    success: true,
    data: result,
  });
};

export const initiateHandover = async (req, res) => {
  const result = await handoverService.initiateHandover(req.body);

  res.status(201).json({
    success: true,
    data: result,
  });
};

export const confirmHandover = async (req, res) => {
  const result = await handoverService.confirmHandover(
    req.params.reference,
    req.body.recycler_id,
    req.body
  );

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const getHandover = async (req, res) => {
  const result = await handoverService.getHandoverByReference(req.params.reference);

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const getHandoversByLot = async (req, res) => {
  const result = await handoverService.getHandoversByLot(req.params.lotId);

  res.status(200).json({
    success: true,
    count: result.length,
    data: result,
  });
};

export const getLotsByCollector = async (req, res) => {
  const result = await handoverService.getLotsByCollector(req.params.collectorId);

  res.status(200).json({
    success: true,
    count: result.length,
    data: result,
  });
};

export const getLotsByRecycler = async (req, res) => {
  const result = await handoverService.getLotsByRecycler(req.params.recyclerId);

  res.status(200).json({
    success: true,
    count: result.length,
    data: result,
  });
};

/**
 * GET /v1/handover/lots/:lotId/events
 * Returns the full ordered event history for a lot, plus all lot_images rows.
 * This is the endpoint that powers the traceability timeline page.
 */
export const getLotEvents = async (req, res) => {
  const result = await handoverService.getLotEvents(req.params.lotId);

  res.status(200).json({
    success: true,
    data: result,
  });
};

/**
 * GET /v1/handover/lots/:lotId/images
 * Returns all lot_images rows for a lot (photo evidence chain).
 */
export const getLotImages = async (req, res) => {
  const result = await handoverService.getLotImages(req.params.lotId);

  res.status(200).json({
    success: true,
    count: result.length,
    data: result,
  });
};

export const cancelOrDeleteLot = async (req, res) => {
  const { lotId } = req.params;
  const collectorId = req.body?.collector_id || req.query?.collector_id || null;
  const reason = req.body?.reason;

  const result = await handoverService.cancelOrDeleteLot(lotId, collectorId, { reason });

  res.status(200).json({
    success: true,
    data: result,
  });
};

