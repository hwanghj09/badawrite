export function outputNames(documents) {
  const used = new Set();
  return documents.map(document => {
    const base = (document.name.replace(/\.(pdf|txt|png|jpe?g|webp)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'listening').slice(0, 100);
    let name = `${base}.wav`;
    let index = 2;
    while (used.has(name.toLowerCase())) name = `${base} (${index++}).wav`;
    used.add(name.toLowerCase());
    return name;
  });
}
