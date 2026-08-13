/**
 * Keeps track of which attempt at something is the current one, so that a
 * slower earlier attempt cannot finish over the top of a faster later one.
 *
 * Opening a document is the case it exists for: reading one can take as long as
 * a connection to another machine, and nothing stops the user from asking for a
 * different document while it is still coming. Whichever arrives first, the one
 * they asked for last is the one they want on screen.
 */
export function createLatest(): {
  start: () => number;
  isCurrent: (attempt: number) => boolean;
} {
  let latest = 0;
  return {
    start: () => ++latest,
    isCurrent: (attempt: number) => attempt === latest,
  };
}
