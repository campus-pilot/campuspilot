const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]!;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]!;
      previous[rightIndex] = Math.min(
        above + 1,
        previous[rightIndex - 1]! + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length]!;
}

/**
 * Returns a deterministic client-side relevance score. Registered actions and
 * cached examinations use this instead of cmdk filtering so server-ranked
 * admissions can share the same list without being discarded.
 */
export function commandFuzzyScore(query: string, fields: readonly string[]) {
  const needle = normalize(query);
  if (!needle) return 0;
  const values = fields.map(normalize).filter(Boolean);
  let best: number | null = null;

  for (const value of values) {
    if (value === needle) best = Math.max(best ?? 0, 1000);
    else if (value.startsWith(needle))
      best = Math.max(best ?? 0, 900 - (value.length - needle.length));
    else {
      const substringIndex = value.indexOf(needle);
      if (substringIndex >= 0)
        best = Math.max(best ?? 0, 800 - substringIndex);
    }

    for (const word of value.split(/[^a-z0-9]+/).filter(Boolean)) {
      if (word.startsWith(needle))
        best = Math.max(best ?? 0, 700 - (word.length - needle.length));
      const tolerance = needle.length >= 7 ? 2 : needle.length >= 4 ? 1 : 0;
      if (tolerance && Math.abs(word.length - needle.length) <= tolerance) {
        const distance = editDistance(needle, word);
        if (distance <= tolerance)
          best = Math.max(best ?? 0, 600 - distance * 25);
      }
    }
  }

  return best;
}

type SearchableCommand = {
  label: string;
  description: string;
  keywords: readonly string[];
  defaultSuggestion: boolean;
};

export function filterManagementCommands<T extends SearchableCommand>(
  commands: readonly T[],
  query: string,
) {
  if (!query.trim()) return commands.filter((command) => command.defaultSuggestion);
  return commands
    .map((command) => ({
      command,
      score: commandFuzzyScore(query, [
        command.label,
        command.description,
        ...command.keywords,
      ]),
    }))
    .filter(
      (entry): entry is { command: T; score: number } => entry.score !== null,
    )
    .sort(
      (left, right) =>
        right.score - left.score || left.command.label.localeCompare(right.command.label),
    )
    .map(({ command }) => command);
}

export type PaginatedPage<T> = {
  items: T[];
  pagination: { totalPages: number };
};

/**
 * Loads every server page in order so client-side command search does not hide
 * examinations merely because they are outside the first page.
 */
export async function collectAllPages<T>(
  loadPage: (page: number) => Promise<PaginatedPage<T>>,
) {
  const items: T[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const result = await loadPage(page);
    items.push(...result.items);
    totalPages = result.pagination.totalPages;
    page += 1;
  }
  return items;
}

/**
 * Composes per-resource client reads with a fixed worker count. This keeps the
 * command palette responsive without issuing an unbounded request burst when a
 * session contains many completed examinations.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer');
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export function hasStudentExamResult(input: {
  assessment: unknown;
  subjects: Array<{ result: unknown }>;
}) {
  return Boolean(
    input.assessment || input.subjects.some((subject) => subject.result),
  );
}

export function hasFinanceActionConfig(
  config: { currency?: string | null; timeZone?: string | null } | null | undefined,
) {
  return Boolean(config?.currency && config.timeZone);
}

export function schoolSessionLabel(session: {
  sessionStartYear: number;
  sessionEndYear: number;
}) {
  return `${session.sessionStartYear}–${session.sessionEndYear}`;
}

export function commandPaletteContextKey(schoolId: string, sessionId?: string) {
  return `${schoolId}:${sessionId ?? 'school'}`;
}
