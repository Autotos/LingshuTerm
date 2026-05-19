export type TaskType = 'scheduled' | 'realtime';

export interface Task {
  id: string;
  /** The session this task belongs to */
  sessionId: string;
  name: string;
  type: TaskType;
  isEnabled: boolean;
  createdAt: string;

  action: {
    useAI: boolean;
    prompt?: string;
    command?: string;
  };

  /** Scheduled task config */
  schedule?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'custom_range';
    days?: number[];
    startTime: string; // HH:mm
    intervalMinutes?: number;
    repeatCount?: number;
    endTime?: string;
  };

  /** Realtime monitor config */
  monitor?: {
    /** Target session connectionIds (empty = all sessions) */
    targetSessionIds: string[];
    triggerKeywords: string[];
    /** 'once' = fire once per keyword, 'count' = up to N times, 'every' = every match */
    triggerMode: 'once' | 'count' | 'every';
    triggerCount?: number;
  };
}

let _seq = 0;
export function generateTaskId(): string {
  _seq++;
  return `task-${Date.now()}-${_seq}`;
}
