import * as collectorService from '../services/collectors.service.js';

export const register = async (req, res) => {
  const data = await collectorService.registerCollector(req.body);
  res.status(201).json({ success: true, data });
};

export const login = async (req, res) => {
  const { phone } = req.body;
  const data = await collectorService.loginCollector(phone);
  res.status(200).json({ success: true, data });
};

export const getProfile = async (req, res) => {
  const data = await collectorService.getCollector(req.params.id);
  res.status(200).json({ success: true, data });
};

export const updateProfile = async (req, res) => {
  const data = await collectorService.updateCollector(req.params.id, req.body);
  res.status(200).json({ success: true, data });
};