import { ExamTiming, examTimingBounds } from './exams';

// Candidate exam ends strictly after the timetable exam starts.
// Paired with a range query on examDate < timetable exam end, this is examIntervalsOverlap.
// Missing exam date or duration does not count as a clash, matching findExamClashes.
const CANDIDATE_ENDS_AFTER_TIMETABLE_START = `
if (doc['semesterData.examDate'].size() == 0 || doc['semesterData.examDuration'].size() == 0) {
  return false;
}
long start = doc['semesterData.examDate'].value.toInstant().toEpochMilli();
long end = start + doc['semesterData.examDuration'].value * 60000L;
return end > params.examStart;
`.trim();

type OverlapClause = {
  bool: {
    must: [
      {
        range: {
          'semesterData.examDate': {
            lt: string;
          };
        };
      },
      {
        script: {
          script: {
            source: string;
            params: {
              examStart: number;
            };
          };
        };
      },
    ];
  };
};

function overlapClause(bounds: { startMs: number; endMs: number }): OverlapClause {
  return {
    bool: {
      must: [
        {
          range: {
            'semesterData.examDate': {
              lt: new Date(bounds.endMs).toISOString(),
            },
          },
        },
        {
          script: {
            script: {
              source: CANDIDATE_ENDS_AFTER_TIMETABLE_START,
              params: {
                examStart: bounds.startMs,
              },
            },
          },
        },
      ],
    },
  };
}

// Elasticsearch filter that excludes modules whose exam overlaps any of `timings`.
// Returns null when there is nothing to clash with (no timetable exams).
export function buildNoExamClashFilter(timings: ExamTiming[]) {
  const seen = new Set<string>();
  const clauses: OverlapClause[] = [];
  for (const timing of timings) {
    const bounds = examTimingBounds(timing);
    if (!bounds) continue;
    const key = `${bounds.startMs}:${bounds.endMs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clauses.push(overlapClause(bounds));
  }

  if (clauses.length === 0) return null;

  return {
    bool: {
      must_not: {
        nested: {
          path: 'semesterData',
          query: {
            bool: {
              should: clauses,
              minimum_should_match: 1,
            },
          },
        },
      },
    },
  };
}
