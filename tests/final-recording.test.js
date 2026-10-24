import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { finalizeRecording } from '../src/final-recording.js';
import { loadExamAudio } from '../src/exam-audio.js';
import { parseScript, encodeWav, joinWav } from '../src/script.js';
import { synthesize, SAMPLE_RATE } from '../src/audio.js';
import { zipSync, unzipSync } from 'fflate';

test('final WAV and ZIP restore missing sounds, preserve existing sounds, and rebuild actual cue positions', async t => {
  t.mock.method(globalThis, 'fetch', async url => new Response(await readFile(new URL(`../public${url}`, import.meta.url))));
  const assets = await loadExamAudio();
  const questions = parseScript('1. W: Hello.\n2. M: Goodbye.');
  const speak = async () => new Float32Array(2400).fill(0.25);
  const settings = { examAudio: true, questionChime: true, turnGap: 0, questionGap: 1 };
  const partsFor = async options => {
    const parts = [];
    await synthesize(questions, { ...settings, ...options, streamOnly: true }, speak, undefined,
      ({ samples }) => parts.push(new Blob([encodeWav(samples)])));
    return parts;
  };
  const bare = await partsFor({ questionChime: false });
  const reference = await partsFor(assets);
  const result = await finalizeRecording(bare, questions, settings);
  assert.equal(result.repaired, 2);
  assert.deepEqual(result.cues, { intro: true, chime: true });
  assert.deepEqual(await result.blob.arrayBuffer(), await joinWav(reference).arrayBuffer());
  assert.ok(Math.abs(result.markers[0].end - (11.3 + 2.2 + 0.1)) < 0.00001);
  assert.equal(result.markers[1].start, result.durations[0]);
  const pcm = new Int16Array((await result.blob.arrayBuffer()).slice(44));
  const bellPcm = new Int16Array(encodeWav(assets.chime).slice(44));
  for (const start of [11.3, result.markers[1].start]) {
    const offset = Math.round(start * SAMPLE_RATE);
    assert.deepEqual(pcm.slice(offset, offset + bellPcm.length), bellPcm);
  }
  const archive = unzipSync(zipSync({ 'listening.wav': new Uint8Array(await result.blob.arrayBuffer()) }));
  assert.deepEqual(archive['listening.wav'], new Uint8Array(await result.blob.arrayBuffer()));

  const existing = await finalizeRecording(reference, questions, settings);
  assert.equal(existing.repaired, 0);
  assert.deepEqual(await existing.blob.arrayBuffer(), await result.blob.arrayBuffer());

  const onlyIntro = await partsFor({ intro: assets.intro, questionChime: false });
  const restoredBells = await finalizeRecording(onlyIntro, questions, settings);
  assert.deepEqual(await restoredBells.blob.arrayBuffer(), await result.blob.arrayBuffer());
  const onlyBells = await partsFor({ chime: assets.chime });
  const restoredIntro = await finalizeRecording(onlyBells, questions, settings);
  assert.equal(restoredIntro.repaired, 1);
  assert.deepEqual(await restoredIntro.blob.arrayBuffer(), await result.blob.arrayBuffer());
  const rawIntro = new Blob([await readFile(new URL('../public/audio/csat-intro.wav', import.meta.url))]);
  const rawBell = new Blob([await readFile(new URL('../public/audio/csat-chime.wav', import.meta.url))]);
  const legacy = [joinWav([rawIntro, rawBell, bare[0]]), joinWav([rawBell, bare[1]])];
  const rounded = await finalizeRecording(legacy, questions, settings);
  assert.equal(rounded.repaired, 0);
  assert.deepEqual(await rounded.blob.arrayBuffer(), await joinWav(legacy).arrayBuffer());
});

test('explicit sound-off choices are preserved, missing data and damaged WAVs fail clearly, cancellation is honoured', async () => {
  const questions = parseScript('1. W: Hello.');
  const bare = new Blob([encodeWav(new Float32Array([0.25]))]);
  const off = await finalizeRecording([bare], questions, { examAudio: false, questionChime: false });
  assert.deepEqual(await off.blob.arrayBuffer(), await bare.arrayBuffer());
  assert.deepEqual(off.cues, { intro: false, chime: false });
  await assert.rejects(finalizeRecording([undefined], questions), /완성되지/);
  await assert.rejects(finalizeRecording([], []), /완성되지/);
  await assert.rejects(finalizeRecording([new Blob(['bad'])], questions, { examAudio: false, questionChime: false }), /WAV/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(finalizeRecording([bare], questions, {}, controller.signal), error => error.name === 'AbortError');
});
