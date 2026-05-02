// Phase 1: Winston logger setup for structured logging
const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'edumaster-backend' },
  transports: [
    new transports.Console(),
    // Add file or cloud transports as needed
  ],
});

module.exports = logger;
