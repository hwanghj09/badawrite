export function estimateProgress(total, completed, elapsed) {
  const fraction = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
  return { percent: Math.floor(fraction * 100), seconds: fraction > 0 && elapsed > 0 ? Math.ceil(elapsed * (1 - fraction) / fraction) : null };
}
