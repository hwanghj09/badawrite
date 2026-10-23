// A long central rule separates the two reading columns in many scanned answer sheets.
// Inspect only the middle of the page so table borders and page edges do not split it.
export function readingRegions({ data, width, height }) {
  const top = Math.floor(height * 0.1), bottom = Math.floor(height * 0.9);
  const left = Math.floor(width * 0.42), right = Math.ceil(width * 0.58);
  const counts = new Uint32Array(width);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * width + x) * 4;
      if (data[i] < 150 && data[i + 1] < 150 && data[i + 2] < 150) counts[x]++;
    }
  }
  let divider = left;
  for (let x = left + 1; x < right; x++) if (counts[x] > counts[divider]) divider = x;
  if (counts[divider] < (bottom - top) * 0.3) return [{ left: 0, top: 0, width, height }];
  let run = 0, longest = 0;
  for (let y = top; y < bottom; y++) {
    const i = (y * width + divider) * 4;
    run = data[i] < 150 && data[i + 1] < 150 && data[i + 2] < 150 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  if (longest < Math.max(60, (bottom - top) * 0.14)) return [{ left: 0, top: 0, width, height }];
  const margin = Math.max(2, Math.round(width * 0.002));
  return [
    { left: 0, top: 0, width: divider - margin, height },
    { left: divider + margin, top: 0, width: width - divider - margin, height },
  ];
}
