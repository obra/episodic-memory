/**
 * Pagination defaults and thresholds for conversation reading
 */
export const PAGINATION_DEFAULTS = {
  /** Default number of lines per page */
  PAGE_SIZE: 100,

  /** Warn if file has more lines than this */
  WARN_THRESHOLD_LINES: 100,

  /** Warn if file is larger than this (KB) */
  WARN_THRESHOLD_KB: 500,

  /** Auto-truncate to this many lines when no range specified */
  AUTO_TRUNCATE_LINES: 100,
};
