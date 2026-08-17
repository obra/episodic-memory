import { RcloneTransport } from './rclone-transport.js';
interface ArchiveShowOptions {
    dbPath?: string;
    cacheDir?: string;
    transport?: Pick<RcloneTransport, 'downloadVerified'>;
    format?: 'markdown' | 'html';
    startLine?: number;
    endLine?: number;
    freeBytes?: (cacheDir: string) => number;
}
export declare function showArchivedConversation(identity: string, options?: ArchiveShowOptions): Promise<string>;
export {};
