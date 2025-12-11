import { TimeWindow } from '@guess5-dashboard/shared';
import { config } from '../config';

export const WINDOWS: Record<TimeWindow, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

export function buildWindowClause(window: TimeWindow): { clause: string; params: any[] } {
  return {
    clause: `NOW() - INTERVAL '${WINDOWS[window]}'`,
    params: [],
  };
}







