import fs from 'fs';
import path from 'path';
import { getSuperpowersDir } from './paths.js';
export function getLogDir() {
    const dir = path.join(getSuperpowersDir(), 'logs');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
export function getSyncLogPath() {
    return path.join(getLogDir(), 'episodic-memory.log');
}
export function formatLogLine(level, message) {
    return `${new Date().toISOString()} [${level}] ${message}\n`;
}
export function appendLogLine(level, message) {
    fs.appendFileSync(getSyncLogPath(), formatLogLine(level, message), 'utf-8');
}
