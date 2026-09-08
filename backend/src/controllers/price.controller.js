import * as priceService from '../services/price.service.js';
import * as marketPriceService from '../services/marketPrice.service.js';

export const getPriceTrends = async (req, res) => {
  const { category, location, days } = req.query;

  const trends = await priceService.getPriceTrends(
    category,
    location,
    days
  );

  res.status(200).json({
    success: true,
    data: trends,
  });
};

export const getMarketPulse = async (req, res) => {
  const { location = 'Bengaluru' } = req.query;
  const pulse = await marketPriceService.getLiveMarketPulse(location);

  res.status(200).json({
    success: true,
    ...pulse,
  });
};

export const refreshMarketPrices = async (req, res) => {
  const days = req.body?.days || 90;
  await marketPriceService.seedDynamicNationalPrices(days);

  res.status(200).json({
    success: true,
    message: 'Market prices refreshed successfully across all Indian metro hubs',
  });
};
