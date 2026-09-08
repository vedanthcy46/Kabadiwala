import app from './app.js';
import { logger } from './utils/logger.js';
import { pool } from './db.js';
import { startKeepAlive } from './utils/keepAlive.js';
import { backfillMissingCoordinates } from './services/location.service.js';
import { seedDynamicNationalPrices } from './services/marketPrice.service.js';
import { seedNationalRecyclers } from './seedNationalRecyclers.js';

const PORT = process.env.PORT || 3000;

let server;

// Verify DB Connection before starting the server
pool.query('SELECT NOW()')
  .then(async () => {
    logger.info('Connected to PostgreSQL database');

    server = app.listen(PORT, () => {
      logger.info(`Listening to port ${PORT}`);
      startKeepAlive();
    });

    // Run background data sync and seeding asynchronously without blocking HTTP server
    (async () => {
      try {
        const recCount = await pool.query('SELECT COUNT(*)::int AS count FROM recyclers');
        if (recCount.rows[0].count < 50) {
          await seedNationalRecyclers({ verbose: false });
        }
      } catch (err) {
        logger.warn('National recyclers seed notice:', err.message);
      }
      await backfillMissingCoordinates().catch(() => {});
      await seedDynamicNationalPrices(90).catch((err) => {
        logger.warn('Dynamic price sync warning:', err.message);
      });
    })().catch((err) => {
      logger.warn('Background sync notice:', err.message);
    });
  })
  .catch((err) => {
    logger.error('Unable to connect to the database:', err);
    process.exit(1);
  });

const exitHandler = () => {
  if (server) {
    server.close(() => {
      logger.info('Server closed');
      pool.end().then(() => {
        logger.info('Database pool closed');
        process.exit(1);
      });
    });
  } else {
    process.exit(1);
  }
};

const unexpectedErrorHandler = (error) => {
  logger.error(error);
  exitHandler();
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  if (server) {
    server.close();
  }
});
