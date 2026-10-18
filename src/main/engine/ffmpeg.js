'use strict';

const { spawn } = require('node:child_process');

let ffmpegPath = null;

function getFfmpegPath() {
  if (ffmpegPath) return ffmpegPath;
  if (process.env.CONVERTDRAG_FFMPEG) return (ffmpegPath = process.env.CONVERTDRAG_FFMPEG);
  // Inside a packaged app the binary is unpacked next to app.asar.
  ffmpegPath = require('ffmpeg-static').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return ffmpegPath;
}

function parseTime(s) {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/**
 * Run ffmpeg. Resolves with {stdout, stderr}; rejects with the last lines of
 * stderr on a non-zero exit.
 * @param {string[]} args
 * @param {{duration?: number, onProgress?: (fraction: number) => void, signal?: AbortSignal}} [opts]
 */
function run(args, { duration = 0, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegPath(), ['-hide_banner', '-nostdin', ...args], { windowsHide: true });
    const out = [];
    let err = '';
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (err.length > 200_000) err = err.slice(-100_000);
      if (onProgress && duration > 0) {
        const m = /time=(\S+)/g;
        let last = null;
        let hit;
        while ((hit = m.exec(s))) last = hit[1];
        const t = last && parseTime(last);
        if (t != null) onProgress(Math.max(0, Math.min(1, t / duration)));
      }
    });
    const abort = () => proc.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    proc.on('error', reject);
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (code === 0) return resolve({ stdout: Buffer.concat(out), stderr: err });
      const tail = err.trim().split('\n').slice(-4).join('\n');
      reject(new Error(signal?.aborted ? 'Cancelled' : `ffmpeg failed: ${tail}`));
    });
  });
}

/**
 * Read basic stream info by parsing `ffmpeg -i` output (avoids shipping ffprobe).
 * @param {string} file
 */
async function probe(file) {
  // `ffmpeg -i` with no output exits 1, but prints the stream info first.
  const stderr = await new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegPath(), ['-hide_banner', '-nostdin', '-i', file], { windowsHide: true });
    let s = '';
    proc.stderr.on('data', (d) => (s += d));
    proc.on('error', reject);
    proc.on('close', () => resolve(s));
  });
  const info = { duration: 0, hasVideo: false, hasAudio: false, width: 0, height: 0, fps: 0, videoCodec: null, audioCodec: null };
  const d = /Duration:\s*([\d:.]+)/.exec(stderr);
  if (d) info.duration = parseTime(d[1]) || 0;
  for (const line of stderr.split('\n')) {
    if (!/Stream #/.test(line)) continue;
    if (/Video:/.test(line) && !/attached pic/.test(line) && !info.hasVideo) {
      info.hasVideo = true;
      info.videoCodec = (/Video:\s*(\w+)/.exec(line) || [])[1] || null;
      const wh = /,\s*(\d{2,5})x(\d{2,5})/.exec(line);
      if (wh) {
        info.width = Number(wh[1]);
        info.height = Number(wh[2]);
      }
      const fps = /([\d.]+)\s*fps/.exec(line);
      if (fps) info.fps = Number(fps[1]);
    } else if (/Audio:/.test(line) && !info.hasAudio) {
      info.hasAudio = true;
      info.audioCodec = (/Audio:\s*(\w+)/.exec(line) || [])[1] || null;
    }
  }
  return info;
}

module.exports = { run, probe, getFfmpegPath, parseTime };
