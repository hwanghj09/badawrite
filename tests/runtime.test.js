import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRuntime, deviceProfile } from '../src/tts-runtime.js';

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

test('iPad desktop UA, iPhone, Android and limited-memory computers bypass GPU and parallel WASM', async () => {
  for (const info of [
    { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', hardwareConcurrency: 8 },
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 5, hardwareConcurrency: 8 },
    { userAgent: 'iPhone', hardwareConcurrency: 6 },
    { userAgent: 'Android', hardwareConcurrency: 8, deviceMemory: 8 },
    { deviceMemory: 4, hardwareConcurrency: 8 },
    { hardwareConcurrency: 2 },
  ]) {
    const profile = deviceProfile(info);
    assert.equal(profile.lowMemory, true);
    assert.ok(profile.cacheBytes <= 4 * 1024 * 1024);
    assert.ok(profile.maxOcrPixels <= 3000000);
    const gpu = { requestAdapter() { assert.fail('A memory-limited device must not initialise a large GPU model'); } };
    assert.deepEqual(await chooseRuntime({ gpu, isolated: true, cores: 8, ...profile }), { device: 'wasm', dtype: 'q8', threads: 1 });
  }
});

test('desktop Macs and capable desktops retain acceleration without misclassifying unknown RAM as zero', () => {
  assert.equal(deviceProfile({ platform: 'MacIntel', maxTouchPoints: 0, hardwareConcurrency: 8 }).lowMemory, false);
  assert.equal(deviceProfile({ deviceMemory: 8, hardwareConcurrency: 8 }).lowMemory, false);
  assert.equal(deviceProfile().lowMemory, false);
});
