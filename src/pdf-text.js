export function textFromPdfItems(items) {
  const lines = [];
  let line = '';
  let y;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const nextY = item.transform?.[5];
    if (line && y !== undefined && nextY !== undefined && Math.abs(nextY - y) > Math.max(2, (item.height || 10) * 0.5)) {
      lines.push(line.trim()); line = '';
    }
    line += `${line && item.str ? ' ' : ''}${item.str}`;
    y = nextY;
    if (item.hasEOL) { lines.push(line.trim()); line = ''; y = undefined; }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}
