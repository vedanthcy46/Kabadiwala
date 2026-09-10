import * as adminService from '../services/admin.service.js';

export const adminLogin = async (req, res) => {
  const data = await adminService.adminLogin(req.body.code);

  res.status(200).json({ success: true, data });
};

export const getSummary = async (req, res) => {
  const data = await adminService.adminSummary();

  res.status(200).json({ success: true, data });
};

export const verifyRecycler = async (req, res) => {
  const data = await adminService.verifyRecycler(req.params.id, req.body);

  res.status(200).json({ success: true, data });
};

export const getPriceSources = async (req, res) => {
  const data = await adminService.listPriceSources();
  res.status(200).json({ success: true, count: data.length, data });
};

export const createPriceSource = async (req, res) => {
  const data = await adminService.createPriceSource(req.body);
  res.status(201).json({ success: true, data });
};

export const updatePriceSource = async (req, res) => {
  const data = await adminService.updatePriceSource(req.params.id, req.body);
  res.status(200).json({ success: true, data });
};

export const deletePriceSource = async (req, res) => {
  const data = await adminService.deletePriceSource(req.params.id);
  res.status(200).json({ success: true, data });
};

export const getLotRegister = async (req, res) => {
  const data = await adminService.listLotRegister();
  res.status(200).json({ success: true, count: data.length, data });
};

export const getAuditEvents = async (req, res) => {
  const data = await adminService.listAuditEvents();
  res.status(200).json({ success: true, count: data.length, data });
};

export const getAnalytics = async (req, res) => {
  const data = await adminService.adminAnalytics();
  res.status(200).json({ success: true, data });
};

export const getHeatmap = async (req, res) => {
  const data = await adminService.adminHeatmapData();
  res.status(200).json({ success: true, data });
};
