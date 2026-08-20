import pino from 'pino';
import { loadConfig } from './config';
import { openDatabase } from './database';
import { createPilotHttpServer } from './http';
import { PilotStore } from './store';
import { OpenAiParseUpstream } from './upstream';

const config = loadConfig();
const logger = pino({
  level: config.logLevel,
  base: { service: 'bookkeeping-managed-ai-pilot' },
  redact: {
    paths: [
      '*.apiKey',
      '*.invite_code',
      '*.access_token',
      '*.authorization',
      '*.raw_text',
      '*.recipient_label',
      '*.adminPassword',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
});
const database = openDatabase(config.databasePath);
const store = new PilotStore(database, config);
const upstream = new OpenAiParseUpstream(config);
const server = createPilotHttpServer(config, store, upstream, logger);

server.listen(config.port, config.host, () => {
  logger.info({ status: 'started', host: config.host, port: config.port });
});

function shutdown(signal: string): void {
  logger.info({ status: 'stopping', signal });
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
