import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import 'express-async-errors'; // catches async errors and passes them to next()
import { logger } from './utils/logger.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { ApiError } from './utils/ApiError.js';
import routes from './routes/v1/index.js';

const app = express();

// Set security HTTP headers
app.use(helmet());

// Parse json request body
// Evidence photos arrive as compressed data URLs and are immediately sent to
// Cloudinary; keep the request limit bounded to prevent oversized uploads.
app.use(express.json({ limit: '7mb' }));

// Parse urlencoded request body
app.use(express.urlencoded({ extended: true }));

// Enable CORS
// Allowed origins (in priority order):
//   1. CORS_ORIGIN env var — comma-separated list set in Render dashboard
//   2. Hardcoded Netlify production URL — always allowed even if env var is missing
//   3. localhost variants — allowed in development
const ALWAYS_ALLOWED = [
  'https://kabadiwalaconnect.netlify.app',
];

const envOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

const allowedOrigins = new Set([
  ...ALWAYS_ALLOWED,
  ...envOrigins,
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
]);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Id'],
}));

// Respond to all OPTIONS preflight requests immediately
app.options('*', cors());

// HTTP request logging
app.use(pinoHttp({ logger }));

// API Version 1 routes
app.use('/v1', routes);

// Handle unknown API routes
app.use((req, res, next) => {
  next(new ApiError(404, 'Not found'));
});

// Global Error Handler
app.use(errorHandler);

export default app;
