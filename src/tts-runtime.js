// iPadOS can identify itself as a desktop Mac and does not expose deviceMemory.
// CPU count alone is not evidence that a mobile browser has a large memory budget.
export function deviceProfile(info = {}, { safe = false } = {}) {
  const mobile = /iPad|iPhone|iPod|Android|Mobile/i.test(info.userAgent || '')
    || (/Mac/i.test(info.platform || '') && info.maxTouchPoints > 1);
  const memory = Number(info.deviceMemory);
  const cores = Number(info.hardwareConcurrency);
  const lowMemory = safe || mobile || (memory > 0 && memory <= 4) || (cores > 0 && cores <= 2);
  return { lowMemory, cacheBytes: (lowMemory ? 4 : 64) * 1024 * 1024, maxOcrPixels: lowMemory ? 3000000 : 6000000 };
}

export async function chooseRuntime({ gpu, isolated = false, cores = 1, forceWasm = false, lowMemory = false } = {}) {
  const threads = isolated && !lowMemory ? Math.min(4, Math.max(1, Math.floor(cores || 1) - 1)) : 1;
  if (!lowMemory && !forceWasm && gpu) {
    let timer;
    try {
      const adapter = await Promise.race([
        gpu.requestAdapter({ powerPreference: 'high-performance' }),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 1500); }),
      ]);
      if (adapter && !adapter.isFallbackAdapter && !adapter.info?.isFallbackAdapter) return { device: 'webgpu', dtype: 'fp32', threads };
    } catch { /* GPU denial and unsupported hardware use the CPU. */ }
    finally { clearTimeout(timer); }
  }
  return { device: 'wasm', dtype: 'q8', threads };
}
