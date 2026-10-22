import { ExamTiming, examEndMs, examIntervalsOverlap, examTimingsOverlap } from './exams';
import { buildNoExamClashFilter } from './examClashFilter';

const SAME_START = '2017-11-29T17:00+0800';
const OVERLAPPING_START = '2017-11-29T18:00+0800';
const ADJACENT_START = '2017-11-29T19:00+0800';

type ClashFilter = NonNullable<ReturnType<typeof buildNoExamClashFilter>>;

// Applies the same inequalities the Elasticsearch clause encodes.
function filterExcludes(filter: ClashFilter | null, candidate: ExamTiming): boolean {
  if (!filter) return false;
  const clauses = filter.bool.must_not.nested.query.bool.should;
  return clauses.some((clause) => {
    const timetableEnd = new Date(clause.bool.must[0].range['semesterData.examDate'].lt).getTime();
    const timetableStart = clause.bool.must[1].script.script.params.examStart;
    const candidateStart = new Date(candidate.start).getTime();
    if (!Number.isFinite(candidateStart) || candidate.duration <= 0) return false;
    return examIntervalsOverlap(
      candidateStart,
      examEndMs(candidateStart, candidate.duration),
      timetableStart,
      timetableEnd,
    );
  });
}

function expectFilterAgrees(timetable: ExamTiming, candidate: ExamTiming) {
  const filter = buildNoExamClashFilter([timetable]);
  expect(filter).not.toBeNull();
  expect(filterExcludes(filter, candidate)).toBe(examTimingsOverlap(timetable, candidate));
}

test('no exam clash filter excludes exams that overlap with a different start time', () => {
  const timetable = { start: SAME_START, duration: 120 };
  const candidate = { start: OVERLAPPING_START, duration: 120 };
  expect(examTimingsOverlap(timetable, candidate)).toBe(true);
  expectFilterAgrees(timetable, candidate);
});

test('no exam clash filter excludes exams with the same start time', () => {
  const timetable = { start: SAME_START, duration: 120 };
  const candidate = { start: SAME_START, duration: 90 };
  expect(examTimingsOverlap(timetable, candidate)).toBe(true);
  expectFilterAgrees(timetable, candidate);
});

test('no exam clash filter keeps adjacent exams that do not overlap', () => {
  const timetable = { start: SAME_START, duration: 120 };
  const candidate = { start: ADJACENT_START, duration: 120 };
  expect(examTimingsOverlap(timetable, candidate)).toBe(false);
  expectFilterAgrees(timetable, candidate);

  const filter = buildNoExamClashFilter([timetable]);
  if (!filter) throw new Error('expected a clash filter');
  const clause = filter.bool.must_not.nested.query.bool.should[0];
  if (!clause) throw new Error('expected an overlap clause');
  expect(clause.bool.must[0].range['semesterData.examDate']).toEqual({
    lt: '2017-11-29T11:00:00.000Z',
  });
  expect(clause.bool.must[1].script.script.source).toContain('return end > params.examStart;');
});

test('no exam clash filter is omitted when timetable modules have no exams', () => {
  expect(buildNoExamClashFilter([])).toBeNull();
  expect(buildNoExamClashFilter([{ start: SAME_START, duration: 0 }])).toBeNull();

  const filter = buildNoExamClashFilter([{ start: SAME_START, duration: 120 }]);
  if (!filter) throw new Error('expected a clash filter');
  const clause = filter.bool.must_not.nested.query.bool.should[0];
  if (!clause) throw new Error('expected an overlap clause');
  expect(clause.bool.must[1].script.script.source).toContain('return false;');
});

test('no exam clash filter matches a module when any timetable exam overlaps', () => {
  const filter = buildNoExamClashFilter([
    { start: SAME_START, duration: 120 },
    { start: SAME_START, duration: 120 },
    { start: '2017-12-01T09:00+0800', duration: 60 },
  ]);
  expect(filter?.bool.must_not.nested.path).toBe('semesterData');
  expect(filter?.bool.must_not.nested.query.bool.minimum_should_match).toBe(1);
  expect(filter?.bool.must_not.nested.query.bool.should).toHaveLength(2);
  expect(filter?.bool.must_not.nested.query.bool).not.toHaveProperty('must_not');
});
