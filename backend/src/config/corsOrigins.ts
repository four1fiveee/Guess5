export {};

const defaultOrigins = [
  'https://guess5.io',
  'https://www.guess5.io',
  'https://guess5.vercel.app',
  'https://guess5.onrender.com',
  'http://localhost:3000',
  'http://localhost:3001',
];

const normalizeOrigin = (origin?: string) => {
  if (!origin) {
    return '';
  }
  return origin.trim();
};

const computeAllowedOrigins = () => {
  const origins = new Set<string>(defaultOrigins);

  const envOrigin = normalizeOrigin(process.env.FRONTEND_URL);
  if (envOrigin) {
    origins.add(envOrigin);
  }

  const additionalOrigins = normalizeOrigin(process.env.CORS_ADDITIONAL_ORIGINS);
  if (additionalOrigins) {
    additionalOrigins
      .split(',')
      .map((value) => normalizeOrigin(value))
      .filter(Boolean)
      .forEach((value) => origins.add(value));
  }

  return Array.from(origins).filter(Boolean);
};

const cachedOrigins = computeAllowedOrigins();

const getAllowedOrigins = () => {
  return [...cachedOrigins];
};

const isOriginAllowed = (origin?: string) => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }
  return cachedOrigins.includes(normalized);
};

const resolveCorsOrigin = (origin?: string) => {
  const normalized = normalizeOrigin(origin);
  if (normalized && isOriginAllowed(normalized)) {
    return normalized;
  }

  const envOrigin = normalizeOrigin(process.env.FRONTEND_URL);
  if (envOrigin && isOriginAllowed(envOrigin)) {
    return envOrigin;
  }

  return cachedOrigins[0] || '';
};

module.exports = {
  getAllowedOrigins,
  isOriginAllowed,
  resolveCorsOrigin,
};

