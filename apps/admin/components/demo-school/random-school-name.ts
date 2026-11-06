/** First word of a generated demo school name. */
const FIRST_WORDS = [
  'Green', 'Silver', 'Golden', 'Royal', 'Sunrise', 'Blue', 'Bright', 'Crystal',
  'Evergreen', 'Maple', 'Cedar', 'Lotus', 'Harmony', 'Pearl', 'Morning', 'Noble',
  'Saffron', 'Emerald', 'Riverside', 'Unity',
] as const;

/** Second word of a generated demo school name. */
const SECOND_WORDS = [
  'Valley', 'Oak', 'Meadow', 'Heights', 'Hills', 'Grove', 'Springs', 'Park',
  'Field', 'Ridge', 'Garden', 'Star', 'Bridge', 'Brook', 'Vista', 'Horizon',
  'Woods', 'Point', 'Crest', 'Banyan',
] as const;

function pick<T>(values: readonly T[]) {
  return values[Math.floor(Math.random() * values.length)]!;
}

/**
 * A random demo school name: two words followed by "Public School", e.g.
 * "Green Valley Public School". Never returns `current`, so every click visibly
 * changes the name. Only a convenience for the form; uniqueness is not needed
 * because the slug gets a -2, -3… suffix when taken.
 */
export function randomSchoolName(current = '') {
  let name: string;
  do {
    name = `${pick(FIRST_WORDS)} ${pick(SECOND_WORDS)} Public School`;
  } while (name === current);
  return name;
}
