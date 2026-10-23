export async function chooseRuntime({ gpu, isolated = false, cores = 1, forceWasm = false } = {}) {
  const threads = isolated ? Math.min(4, Math.max(1, Math.floor(cores || 1) - 1)) : 1;
  if (!forceWasm && gpu) {
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
