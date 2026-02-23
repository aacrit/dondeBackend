/**
 * Structured JSON logger for recommendation engine.
 * Outputs machine-parseable log lines for monitoring and alerting.
 */

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  ts: string;
  msg: string;
  [key: string]: unknown;
}

function emit(entry: LogEntry): void {
  const output = JSON.stringify(entry);
  if (entry.level === "error") {
    console.error(output);
  } else if (entry.level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export function logInfo(msg: string, ctx?: Record<string, unknown>): void {
  emit({ level: "info", ts: new Date().toISOString(), msg, ...ctx });
}

export function logWarn(msg: string, ctx?: Record<string, unknown>): void {
  emit({ level: "warn", ts: new Date().toISOString(), msg, ...ctx });
}

export function logError(msg: string, ctx?: Record<string, unknown>): void {
  emit({ level: "error", ts: new Date().toISOString(), msg, ...ctx });
}
