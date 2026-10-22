import { get } from 'lodash-es';

import { Module, Semester } from 'types/modules';
import { getModuleSemesterData } from 'utils/modules';
import { CS1010A, CS1010S, CS3216, CS4243, PC1222 } from '__mocks__/modules';

import { examTimingsOverlap, findExamClashes, getExamTiming } from './exams';

const SAME_START = '2017-11-29T17:00+0800';
const OVERLAPPING_START = '2017-11-29T18:00+0800';
const ADJACENT_START = '2017-11-29T19:00+0800';

function moduleWithExam(moduleCode: string, examDate?: string, examDuration?: number): Module {
  return {
    moduleCode,
    semesterData: [
      {
        semester: 1,
        timetable: [],
        ...(examDate ? { examDate } : {}),
        ...(examDuration ? { examDuration } : {}),
      },
    ],
  } as unknown as Module;
}

test('findExamClashes should return non-empty object if exams clash', () => {
  const sem: Semester = 1;
  const examClashes = findExamClashes([CS1010S, CS4243, CS3216], sem);
  const examDate = get(getModuleSemesterData(CS1010S, sem), 'examDate');
  if (!examDate) throw new Error('Cannot find ExamDate');
  expect(examClashes).toEqual({ [examDate]: [CS1010S, CS4243] });
});

test('findExamClashes should return empty object if exams do not clash', () => {
  const sem: Semester = 2;
  const examClashes = findExamClashes([CS1010S, PC1222, CS3216], sem);
  expect(examClashes).toEqual({});
});

test('findExamClashes should return non-empty object if exams starting at different times clash', () => {
  const sem: Semester = 1;
  const examClashes = findExamClashes([CS1010S, CS3216, CS1010A], sem);
  const examDate = get(getModuleSemesterData(CS1010A, sem), 'examDate');
  if (!examDate) throw new Error('Cannot find ExamDate');
  expect(examClashes).toEqual({ [examDate]: [CS1010S, CS1010A] });
});

test('exam timings overlap when start times differ but the intervals overlap', () => {
  expect(
    examTimingsOverlap(
      { start: SAME_START, duration: 120 },
      { start: OVERLAPPING_START, duration: 120 },
    ),
  ).toBe(true);

  const sem: Semester = 1;
  const earlier = moduleWithExam('AAA1000', SAME_START, 120);
  const later = moduleWithExam('BBB1000', OVERLAPPING_START, 120);
  expect(findExamClashes([earlier, later], sem)).toEqual({
    [OVERLAPPING_START]: [earlier, later],
  });
});

test('exam timings overlap when they start at the same time', () => {
  expect(
    examTimingsOverlap({ start: SAME_START, duration: 120 }, { start: SAME_START, duration: 90 }),
  ).toBe(true);

  const sem: Semester = 1;
  const first = moduleWithExam('AAA1000', SAME_START, 120);
  const second = moduleWithExam('BBB1000', SAME_START, 120);
  expect(findExamClashes([first, second], sem)).toEqual({ [SAME_START]: [first, second] });
});

test('adjacent exam timings do not overlap', () => {
  expect(
    examTimingsOverlap(
      { start: SAME_START, duration: 120 },
      { start: ADJACENT_START, duration: 120 },
    ),
  ).toBe(false);

  const sem: Semester = 1;
  const first = moduleWithExam('AAA1000', SAME_START, 120);
  const next = moduleWithExam('BBB1000', ADJACENT_START, 120);
  expect(findExamClashes([first, next], sem)).toEqual({});
});

test('modules without exams are not clashes', () => {
  const sem: Semester = 1;
  const withExam = moduleWithExam('AAA1000', SAME_START, 120);
  const noDate = moduleWithExam('BBB1000');
  const noDuration = moduleWithExam('CCC1000', SAME_START);

  expect(getExamTiming(noDate, sem)).toBeNull();
  expect(getExamTiming(noDuration, sem)).toBeNull();
  expect(
    examTimingsOverlap({ start: SAME_START, duration: 120 }, { start: SAME_START, duration: 0 }),
  ).toBe(false);
  expect(findExamClashes([withExam, noDate, noDuration], sem)).toEqual({});
});
