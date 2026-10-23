import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRuntime } from '../src/tts-runtime.js';

test('isolated browsers use several CPU cores with a bounded thread count', async () => {
  assert.deepEqual(await chooseRuntime({ isolated: true, cores: 8 }), { device: 'wasm', dtype: 'q8', threads: 4 });
  assert.equal((await chooseRuntime({ isolated: true, cores: 1 })).threads, 1);
  assert.equal((await chooseRuntime({ isolated: true })).threads, 1);
  assert.equal((await chooseRuntime({ isolated: false, cores: 8 })).threads, 1);
});

test('a real GPU adapter selects full-precision acceleration without reducing voice quality', async () => {
  const gpu = { async requestAdapter(options) { assert.equal(options.powerPreference, 'high-performance'); return {}; } };
  assert.deepEqual(await chooseRuntime({ gpu, isolated: true, cores: 8 }), { device: 'webgpu', dtype: 'fp32', threads: 4 });
});

test('unavailable, blocked and software GPU adapters fall back to CPU', async () => {
  for (const requestAdapter of [async () => null, async () => { throw new Error('GPU blocked'); }, async () => ({ isFallbackAdapter: true }), async () => ({ info: { isFallbackAdapter: true } })]) {
    assert.deepEqual(await chooseRuntime({ gpu: { requestAdapter }, isolated: true, cores: 4 }), { device: 'wasm', dtype: 'q8', threads: 3 });
  }
});

test('CPU retry skips GPU detection even when GPU support is advertised', async () => {
  assert.deepEqual(await chooseRuntime({ gpu: { requestAdapter() { throw new Error('Must not be called'); } }, forceWasm: true }), { device: 'wasm', dtype: 'q8', threads: 1 });
});
