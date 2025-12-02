/**
 * Session Summary Types
 *
 * Structured types for capturing and searching session summaries
 * with rich metadata for improved retrieval quality.
 */

export interface Decision {
  description: string;
  rationale?: string;
}

export interface FileModification {
  path: string;
  action: 'created' | 'modified' | 'deleted';
}

export interface WorkItem {
  id: string; // feat-XXX, bug-XXX, spike-XXX
  action: 'started' | 'progressed' | 'completed';
}

export interface ToolUsage {
  name: string;
  count: number;
}

export interface Outcome {
  description: string;
  status: 'success' | 'partial' | 'blocked';
}

export interface NextStep {
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface SessionSummary {
  id: string;
  sessionId: string;
  project: string;
  timestamp: string;
  durationMinutes: number;

  summary: {
    oneLiner: string;
    detailed: string;
  };

  decisions: Decision[];
  filesModified: FileModification[];
  workItems: WorkItem[];
  toolsUsed: ToolUsage[];
  outcomes: Outcome[];
  nextSteps: NextStep[];
  tags: string[];

  // For vector search
  embedding?: number[];
}
