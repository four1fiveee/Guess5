import express from 'express';
import cors from 'cors';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config';
import metricsRouter from './routes/metrics';
import adminRouter from './routes/admin';

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

const app = express();

// Middleware
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(pinoHttp({ logger }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api', metricsRouter);
app.use('/api/admin', adminRouter);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = config.server.port;

app.listen(PORT, () => {
  logger.info(`Dashboard API server running on http://localhost:${PORT}`);
  logger.warn('⚠️  This dashboard is LOCAL-ONLY and should NEVER be exposed publicly');
});







