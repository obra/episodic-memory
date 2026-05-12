import fs from 'fs';
import path from 'path';
import { getSuperpowersDir } from './paths.js';

export type LogLevel = 'info' | 'warn' | 'error';

export function getLogDir(): string {
  const dir = path.join(getSuperpowersDir(), 'logs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getSyncLogPath(): string {
  return path.join(getLogDir(), 'episodic-memory.log');
}

export function formatLogLine(level: LogLevel, message: string): string {
  return `${new Date().toISOString()} [${level}] ${message}\n`;
}

export function appendLogLine(level: LogLevel, message: string): void {
  fs.appendFileSync(getSyncLogPath(), formatLogLine(level, message), 'utf-8');
}
