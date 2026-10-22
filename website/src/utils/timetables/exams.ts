import { groupBy } from 'lodash-es';

import { Module, Semester } from 'types/modules';

import { ExamClashes } from 'types/views';

import { getExamDate, getExamDuration } from 'utils/modules';

export type ExamTiming = {
  // ISO exam start, as stored on the module.
  start: string;
  // Exam length in minutes.
  duration: number;
};

// Modules without an exam date or duration cannot clash. A duration of 0 is treated as missing
// because getExamDuration collapses falsy values to null.
export function getExamTiming(module: Module, semester: Semester): ExamTiming | null {
  const start = getExamDate(module, semester);
  const duration = getExamDuration(module, semester);
  if (start == null || duration == null) return null;
  return { start, duration };
}

export function examEndMs(startMs: number, durationMinutes: number): number {
  return startMs + durationMinutes * 60 * 1000;
}

export function examTimingBounds(timing: ExamTiming): { startMs: number; endMs: number } | null {
  const startMs = new Date(timing.start).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(timing.duration) || timing.duration <= 0) {
    return null;
  }
  return { startMs, endMs: examEndMs(startMs, timing.duration) };
}

// Two exams overlap when each starts strictly before the other ends.
// Adjacent exams (one ends exactly when the other starts) do not overlap.
// This is the check introduced for timetable clashes in #3560.
export function examIntervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && startB < endA;
}

export function examTimingsOverlap(a: ExamTiming, b: ExamTiming): boolean {
  const aBounds = examTimingBounds(a);
  const bBounds = examTimingBounds(b);
  if (!aBounds || !bBounds) return false;
  return examIntervalsOverlap(aBounds.startMs, aBounds.endMs, bBounds.startMs, bBounds.endMs);
}

// Creates a key using only the exam date string (without time)
export function getExamDateOnly(module: Module, semester: Semester): string | undefined {
  const examDateTime = getExamDate(module, semester);
  return examDateTime?.slice(0, 10);
}

// Returns the start time of the exam as an epoch time (number). Throws an error if the module
// does not have an exam date.
function getValidExamStartTimeAsEpoch(module: Module, semester: Semester): number {
  const timing = getExamTiming(module, semester);
  const bounds = timing && examTimingBounds(timing);
  if (!bounds) {
    throw new Error('Courses tested for clashes must have exam dates and durations!');
  }
  return bounds.startMs;
}

// Returns the end time of the exam as an epoch time (number). Throws an error if the module
// does not have an exam date or duration.
function getValidExamEndTimeAsEpoch(module: Module, semester: Semester): number {
  const timing = getExamTiming(module, semester);
  const bounds = timing && examTimingBounds(timing);
  if (!bounds) {
    throw new Error('Courses tested for clashes must have exam dates and durations!');
  }
  return bounds.endMs;
}

// Find all exam clashes between modules in semester
// Returns object associating exam dates with the modules clashing on those dates
export function findExamClashes(modules: Module[], semester: Semester): ExamClashes {
  // Filter away modules without exam dates or exam durations
  const filteredModules = modules.filter((module) => getExamTiming(module, semester) !== null);

  const groupedModules = groupBy(filteredModules, (module) => getExamDateOnly(module, semester));

  const clashes: ExamClashes = {};

  Object.values(groupedModules).forEach((sameDayMods) => {
    // Sort sameDayMods by exam start time
    sameDayMods.sort((a, b) => {
      const aStartEpoch = getValidExamStartTimeAsEpoch(a, semester);
      const bStartEpoch = getValidExamStartTimeAsEpoch(b, semester);

      // Use end time as secondary key
      const aEndEpoch = getValidExamEndTimeAsEpoch(a, semester);
      const bEndEpoch = getValidExamEndTimeAsEpoch(b, semester);

      if (aStartEpoch === bStartEpoch) {
        return aEndEpoch - bEndEpoch;
      }

      return aStartEpoch - bStartEpoch;
    });

    // Initialize an empty list to hold the groups of overlapping intervals
    // Each group will itself be a list of intervals
    const overlappingGroups: Module[][] = [];

    let currentOverlapStart = 0;
    let currentOverlapEnd = 0;
    let currentOverlappingMods: Module[] = [];

    sameDayMods.forEach((mod, modIndex) => {
      const modStart = getValidExamStartTimeAsEpoch(mod, semester);
      const modEnd = getValidExamEndTimeAsEpoch(mod, semester);
      if (
        modIndex > 0 &&
        examIntervalsOverlap(modStart, modEnd, currentOverlapStart, currentOverlapEnd)
      ) {
        currentOverlappingMods.push(mod);
      } else {
        // The current course does not overlap with the current group, so we reset
        // the current group and start a new one
        if (currentOverlappingMods.length > 1) {
          // If the current group has more than one module, we add it to the list of clashes
          overlappingGroups.push(currentOverlappingMods);
        }
        currentOverlapStart = modStart;
        currentOverlapEnd = modEnd;
        currentOverlappingMods = [mod];
      }
    });

    // Add the last group to the list of clashes if applicable
    if (currentOverlappingMods.length > 1) {
      overlappingGroups.push(currentOverlappingMods);
    }

    overlappingGroups.forEach((group) => {
      // Displayed clashing date and time, which is the start time of the last module in the group
      const clashingDateTime = getExamDate(group[group.length - 1], semester);

      if (clashingDateTime === null) {
        throw new Error('Courses tested for clashes must have exam dates and durations!');
      }

      // Populate the clashes object to be returned
      group.forEach((mod) => {
        if (!clashes[clashingDateTime]) {
          clashes[clashingDateTime] = [mod];
        } else {
          clashes[clashingDateTime].push(mod);
        }
      });
    });
  });

  return clashes;
}
