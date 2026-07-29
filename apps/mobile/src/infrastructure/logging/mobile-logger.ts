import loglevel from 'loglevel';

type LogValue = string | number | boolean | null | undefined;
type LogFields = Readonly<Record<string, LogValue>>;
type LogMethod = 'debug' | 'info' | 'warn' | 'error';

const rootLogger = loglevel.getLogger('bookkeeping');
rootLogger.setDefaultLevel('info');

function emit(component: string, method: LogMethod, event: string, fields: LogFields = {}): void {
  rootLogger[method]({
    timestamp: new Date().toISOString(),
    component,
    event,
    ...fields,
  });
}

export function sanitizeDiagnosticMessage(message: string | undefined): string | null {
  if (!message) return null;
  return message
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .slice(0, 300);
}

export function createMobileLogger(component: string) {
  return {
    debug: (event: string, fields?: LogFields) => emit(component, 'debug', event, fields),
    info: (event: string, fields?: LogFields) => emit(component, 'info', event, fields),
    warn: (event: string, fields?: LogFields) => emit(component, 'warn', event, fields),
    error: (event: string, fields?: LogFields) => emit(component, 'error', event, fields),
  };
}
