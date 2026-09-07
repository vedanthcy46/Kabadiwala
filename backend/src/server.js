import app from './app.js';
import { logger } from './utils/logger.js';
import { pool } from './db.js';
import { startKeepAlive } from './utils/keepAlive.js';

const PORT = process.env.PORT || 3000;

let server;

// Verify DB Connection before starting the server
pool.query('SELECT NOW()')
  .then(() => {
    logger.info('Connected to PostgreSQL database');
    server = app.listen(PORT, () => {
      logger.info(`Listening to port ${PORT}`);
      startKeepAlive();
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
