import type { ConceptConfig } from '../types.js';

const DEFAULT_TIME = '08:00';

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

export const normalizeTimeString = (value: string): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  const match = TIME_PATTERN.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
};

export const cronFromTime = (time: string): string => {
  const normalized = normalizeTimeString(time);
  if (!normalized) {
    return '0 8 * * *';
  }
  const [hourPart, minutePart] = normalized.split(':');
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  return `${minute} ${hour} * * *`;
};

export const timesFromSchedule = (schedule?: string): string[] => {
  if (!schedule) return [];
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 2) return [];
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return [];
  return [normalizeTimeString(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`) ?? DEFAULT_TIME];
};

export const normalizePostingTimesList = (times: string[]): string[] => {
  const sanitized = times
    .map(time => normalizeTimeString(time))
    .filter((time): time is string => Boolean(time));

  const unique = Array.from(new Set(sanitized));
  unique.sort((a, b) => {
    const [aHour, aMinute] = a.split(':').map(Number);
    const [bHour, bMinute] = b.split(':').map(Number);
    return aHour === bHour ? aMinute - bMinute : aHour - bHour;
  });
  return unique;
};

export const ensurePostingTimesFromConfig = (config: Partial<ConceptConfig>): string[] => {
  const candidateTimes: string[] = Array.isArray((config as any).postingTimes)
    ? ((config as any).postingTimes as string[])
    : [];

  const normalizedCandidates = normalizePostingTimesList(candidateTimes);
  if (normalizedCandidates.length > 0) {
    return normalizedCandidates;
  }

  const derivedFromSchedule = normalizePostingTimesList(timesFromSchedule(config.schedule));
  if (derivedFromSchedule.length > 0) {
    return derivedFromSchedule;
  }

  return [DEFAULT_TIME];
};

export const withNormalizedPostingTimes = (config: ConceptConfig): ConceptConfig => {
  const postingTimes = ensurePostingTimesFromConfig(config);
  const schedule = postingTimes.length > 0 ? cronFromTime(postingTimes[0]) : config.schedule || cronFromTime(DEFAULT_TIME);

  return {
    ...config,
    postingTimes,
    schedule,
  };
};