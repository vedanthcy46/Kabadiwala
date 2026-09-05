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