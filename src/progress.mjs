// Invalid measurements retain the last valid value instead of flashing 0 or 100.
export function safePercent(value, fallback = 0) {
  const valid = (number) =>
    typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 100;
  return valid(value) ? value : valid(fallback) ? fallback : 0;
}

export function advancePercent(value, previous = 0) {
  const current = safePercent(previous);
  return Math.max(current, safePercent(value, current));
}

export function progressTask(project) {
  return (
    project?.progress?.taskId ||
    project?.job?.id ||
    project?.job?.startedAt ||
    project?.failure?.startedAt ||
    null
  );
}
