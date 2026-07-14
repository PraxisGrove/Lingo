export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type LogContext = Record<string, unknown>;

export type Logger = {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
};

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

const PRIVATE_CONTEXT_KEYS = new Set([
  'apikey',
  'authorization',
  'body',
  'credential',
  'endpoint',
  'glossary',
  'headers',
  'hostname',
  'instruction',
  'pagetitle',
  'prompt',
  'sitehostname',
  'siteglossaries',
  'text',
  'translationquality',
  'translatedtext',
  'units',
  'url',
]);

export function getDefaultLogLevel(): LogLevel {
  return import.meta.env.DEV ? 'debug' : 'warn';
}

export function shouldLog(messageLevel: LogLevel, configuredLevel: LogLevel) {
  return (
    LOG_LEVEL_PRIORITY[messageLevel] >= LOG_LEVEL_PRIORITY[configuredLevel]
  );
}

export function createLogger(
  scope: string,
  level: LogLevel = getDefaultLogLevel(),
): Logger {
  const prefix = `[extension:${scope}]`;

  function write(
    messageLevel: Exclude<LogLevel, 'silent'>,
    message: string,
    context?: LogContext,
  ) {
    if (!shouldLog(messageLevel, level)) {
      return;
    }

    const args = context
      ? [prefix, message, serializeLogContext(context)]
      : [prefix, message];
    console[messageLevel](...args);
  }

  return {
    debug(message, context) {
      write('debug', message, context);
    },
    info(message, context) {
      write('info', message, context);
    },
    warn(message, context) {
      write('warn', message, context);
    },
    error(message, context) {
      write('error', message, context);
    },
  };
}

function serializeLogContext(context: LogContext): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(context, (key, value: unknown) => {
    if (PRIVATE_CONTEXT_KEYS.has(key.toLowerCase().replaceAll('_', ''))) {
      return '[Redacted]';
    }
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return redactUrls(value);
    if (typeof value !== 'object' || value === null) return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (value instanceof Error) {
      return {
        ...value,
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    return value;
  });
}

function redactUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s"'\\]+/giu, '[Redacted URL]');
}
