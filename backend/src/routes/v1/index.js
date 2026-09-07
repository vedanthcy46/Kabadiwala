import express from 'express';
import { query } from '../../db.js';
import valuationRoute from './valuation.route.js';
import recyclerRoute from './recycler.route.js';
import priceRoute from './price.route.js';
import handoverRoute from './handover.route.js';
import anomalyRoute from './anomaly.route.js';
import syncRoute from './sync.route.js';
import paymentRoute from './payment.route.js';
import priceIngestRoute from './priceIngest.route.js';
import collectorsRoute from './collectors.route.js';
import offersRoute from './offers.route.js';
import adminRoute from './admin.route.js';
import aiRoute from './ai.route.js';

const router = express.Router();

const defaultRoutes = [
  {
    path: '/valuation',
    route: valuationRoute,
  },
  {
    path: '/recyclers',
    route: recyclerRoute,
  },
  {
    path: '/prices',
    route: priceRoute,
  },
  {
    path: '/handover',
    route: handoverRoute,
  },
  {
    path: '/anomaly',
    route: anomalyRoute,
  },
  {
    path: '/sync',
    route: syncRoute,
  },
  {
    path: '/payments',
    route: paymentRoute,
  },
  {
    path: '/prices/ingest',
    route: priceIngestRoute,
  },
  {
    path: '/collectors',
    route: collectorsRoute,
  },
  {
    path: '/quotes',
    route: offersRoute,
  },
  {
    path: '/admin',
    route: adminRoute,
  },
  {
    path: '/ai',
    route: aiRoute,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

// Health-check endpoint. Also used by external keep-alive monitors (Render
// healthCheckPath, UptimeRobot / cron-job.org, GitHub Actions scheduler) that
// ping this URL every few minutes to stop the free-tier service from sleeping.
router.get('/health', async (req, res) => {
  let db = 'UP';
  try {
    await query('SELECT 1');
  } catch {
    db = 'DOWN';
  }

  const ok = db === 'UP';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'UP' : 'DEGRADED',
    db,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;
