import { type CapacityResult } from './rclone-transport.js';
export interface CacheReservation extends CapacityResult {
    release: () => void;
}
export declare function reserveCacheCapacity(cacheDir: string, localPath: string, nextBytes: number, freeBytes?: () => number): Promise<CacheReservation>;
