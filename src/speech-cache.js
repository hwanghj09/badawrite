// Keep a bounded amount of raw speech so changes to gaps/repeat do not rerun the model.
// synthesize copies these samples into its output before the worker transfers it.
export function cacheSpeech(speak, maxBytes = 64 * 1024 * 1024) {
  const cache = new Map();
  let bytes = 0;
  return async (text, voice) => {
    const key = JSON.stringify([voice, text]);
    if (cache.has(key)) {
      const samples = cache.get(key);
      cache.delete(key); cache.set(key, samples);
      return samples;
    }
    const samples = await speak(text, voice);
    if (samples.byteLength > 0 && samples.byteLength <= maxBytes) {
      while (bytes + samples.byteLength > maxBytes) {
        const oldest = cache.keys().next().value;
        bytes -= cache.get(oldest).byteLength; cache.delete(oldest);
      }
      cache.set(key, samples); bytes += samples.byteLength;
    }
    return samples;
  };
}
