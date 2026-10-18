'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const ffmpeg = require('./ffmpeg');
const { outputFor } = require('./naming');
const { formatOfPath, kindOf } = require('../catalog');

const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
const H264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p'];
const AAC = ['-c:a', 'aac', '-b:a', '192k'];

// Codec arguments per output format. `video` entries keep the picture,
// `audio` entries drop it.
const VIDEO_OUT = {
  mp4: [...H264, ...AAC, '-movflags', '+faststart'],
  mov: [...H264, ...AAC, '-movflags', '+faststart'],
  m4v: [...H264, ...AAC],
  mkv: [...H264, ...AAC],
  webm: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k'],
  avi: ['-c:v', 'mpeg4', '-q:v', '3', '-c:a', 'libmp3lame', '-q:a', '3'],
  wmv: ['-c:v', 'wmv2', '-q:v', '3', '-c:a', 'wmav2', '-b:a', '192k'],
  flv: [...H264, ...AAC],
  mpg: ['-c:v', 'mpeg2video', '-q:v', '3', '-c:a', 'mp2', '-b:a', '192k'],
  '3gp': [...H264, '-c:a', 'aac', '-b:a', '96k'],
  ts: [...H264, ...AAC],
};

const AUDIO_OUT = {
  mp3: { args: ['-c:a', 'libmp3lame', '-q:a', '2'], ext: 'mp3' },
  wav: { args: ['-c:a', 'pcm_s16le'], ext: 'wav' },
  m4a: { args: ['-c:a', 'aac', '-b:a', '192k'], ext: 'm4a' },
  aac: { args: ['-c:a', 'aac', '-b:a', '192k', '-f', 'adts'], ext: 'aac' },
  flac: { args: ['-c:a', 'flac'], ext: 'flac' },
  ogg: { args: ['-c:a', 'libvorbis', '-q:a', '5'], ext: 'ogg' },
  opus: { args: ['-c:a', 'libopus', '-b:a', '128k'], ext: 'opus' },
  aiff: { args: ['-c:a', 'pcm_s16be'], ext: 'aiff' },
  wma: { args: ['-c:a', 'wmav2', '-b:a', '192k'], ext: 'wma' },
};

const COMPRESSED_AUDIO = {
  mp3: ['-c:a', 'libmp3lame', '-b:a', '96k'],
  m4a: ['-c:a', 'aac', '-b:a', '96k'],
  aac: ['-c:a', 'aac', '-b:a', '96k', '-f', 'adts'],
  ogg: ['-c:a', 'libvorbis', '-q:a', '2'],
  opus: ['-c:a', 'libopus', '-b:a', '64k'],
};

function progress(ctx, info) {
  return { duration: info.duration, onProgress: ctx.progress, signal: ctx.signal };
}

function extOf(file) {
  return path.extname(file).slice(1).toLowerCase();
}

/** Same container for edits, but only ones we know how to encode. */
function editContainer(src) {
  const f = formatOfPath(src);
  if (kindOf(f) === 'audio') return AUDIO_OUT[f] ? f : 'mp3';
  return VIDEO_OUT[f] ? f : 'mp4';
}

/** Extension for an edited copy: the source's own if we can write it. */
function editExt(src) {
  const fmt = editContainer(src);
  if (formatOfPath(src) === fmt) return extOf(src);
  return AUDIO_OUT[fmt] ? AUDIO_OUT[fmt].ext : fmt;
}

function encodeArgsFor(fmt) {
  if (AUDIO_OUT[fmt]) return ['-vn', ...AUDIO_OUT[fmt].args];
  if (VIDEO_OUT[fmt]) return VIDEO_OUT[fmt];
  throw new Error(`Can't write ${fmt.toUpperCase()}`);
}

function needsEvenScale(fmt) {
  return !AUDIO_OUT[fmt];
}

async function convert(src, target, ctx) {
  const info = await ffmpeg.probe(src);
  const out = outputFor(src, { ext: target, outDir: ctx.outDir });
  if (target === 'gif') return toGif(src, info, out, ctx);
  if (AUDIO_OUT[target]) {
    if (!info.hasAudio) throw new Error('This file has no audio track');
    await ffmpeg.run(['-i', src, '-map', '0:a:0', ...encodeArgsFor(target), '-y', out], progress(ctx, info));
    return out;
  }
  if (!info.hasVideo) throw new Error('This file has no video track');
  if (target === 'mkv') {
    // Matroska takes almost any codec, so try a lossless remux first.
    try {
      await ffmpeg.run(['-i', src, '-map', '0', '-c', 'copy', '-y', out], progress(ctx, info));
      return out;
    } catch {
      await fs.rm(out, { force: true });
    }
  }
  const audioMap = info.hasAudio ? ['-map', '0:a:0?'] : [];
  await ffmpeg.run(['-i', src, '-map', '0:v:0', ...audioMap, '-vf', EVEN, ...VIDEO_OUT[target], '-y', out], progress(ctx, info));
  return out;
}

async function toGif(src, info, out, ctx) {
  const width = Math.min(info.width || 640, 640);
  const filter = `fps=12,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
  await ffmpeg.run(['-i', src, '-filter_complex', filter, '-loop', '0', '-an', '-y', out], progress(ctx, info));
  return out;
}

async function compress(src, ctx) {
  const info = await ffmpeg.probe(src);
  if (info.hasVideo) {
    const out = outputFor(src, { ext: 'mp4', suffix: ' Compressed', outDir: ctx.outDir });
    const scale = "scale='min(1920,iw)':-2";
    await ffmpeg.run(
      ['-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-vf', scale, '-c:v', 'libx264', '-preset', 'medium', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', out],
      progress(ctx, info),
    );
    return out;
  }
  const f = formatOfPath(src);
  const fmt = COMPRESSED_AUDIO[f] ? f : 'mp3';
  const out = outputFor(src, { ext: AUDIO_OUT[fmt].ext, suffix: ' Compressed', outDir: ctx.outDir });
  await ffmpeg.run(['-i', src, '-vn', ...COMPRESSED_AUDIO[fmt], '-y', out], progress(ctx, info));
  return out;
}

/** @param {{start: number, end: number}} p seconds */
async function trim(src, p, ctx) {
  const info = await ffmpeg.probe(src);
  const start = Math.max(0, Number(p.start) || 0);
  const end = Math.min(info.duration || Infinity, Number(p.end) || info.duration);
  if (!(end > start)) throw new Error('End must be after start');
  const len = end - start;
  const args = ['-ss', String(start), '-i', src, '-t', String(len)];
  let ext = editExt(src);
  if (info.hasVideo) {
    args.push('-map', '0:v:0', '-map', '0:a:0?', '-vf', EVEN, ...VIDEO_OUT[editContainer(src)]);
  } else {
    let fmt = editContainer(src);
    if (!AUDIO_OUT[fmt]) {
      // Audio-only file in a video container.
      fmt = 'm4a';
      ext = 'm4a';
    }
    args.push('-map', '0:a:0', ...AUDIO_OUT[fmt].args);
  }
  const out = outputFor(src, { ext, suffix: ' Trimmed', outDir: ctx.outDir });
  await ffmpeg.run([...args, '-y', out], { duration: len, onProgress: ctx.progress, signal: ctx.signal });
  return out;
}

async function mute(src, ctx) {
  const info = await ffmpeg.probe(src);
  const out = outputFor(src, { ext: editExt(src), suffix: ' Muted', outDir: ctx.outDir });
  try {
    await ffmpeg.run(['-i', src, '-map', '0:v:0', '-c', 'copy', '-an', '-y', out], progress(ctx, info));
  } catch {
    await ffmpeg.run(['-i', src, '-map', '0:v:0', '-an', '-vf', EVEN, ...VIDEO_OUT[editContainer(src)], '-y', out], progress(ctx, info));
  }
  return out;
}

async function resize(src, ctx, height = 720) {
  const info = await ffmpeg.probe(src);
  const fmt = editContainer(src);
  const out = outputFor(src, { ext: editExt(src), suffix: ` ${height}p`, outDir: ctx.outDir });
  const vf = `scale=-2:'min(${height},ih)':flags=lanczos,${EVEN}`;
  await ffmpeg.run(['-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, ...VIDEO_OUT[fmt], '-y', out], progress(ctx, info));
  return out;
}

async function snapshot(src, ctx, at) {
  const info = await ffmpeg.probe(src);
  const t = at ?? Math.min(1, (info.duration || 0) / 2);
  const out = outputFor(src, { ext: 'png', suffix: ' Frame', outDir: ctx.outDir });
  await ffmpeg.run(['-ss', String(t), '-i', src, '-frames:v', '1', '-y', out]);
  return out;
}

/** A small JPEG of one frame, for the trim editor when the browser can't play the file. */
async function frameJpeg(src, at, width = 640) {
  const { stdout } = await ffmpeg.run(['-ss', String(Math.max(0, at)), '-i', src, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1']);
  return stdout;
}

async function rotate(src, ctx) {
  const info = await ffmpeg.probe(src);
  const fmt = editContainer(src);
  const out = outputFor(src, { ext: editExt(src), suffix: ' Rotated', outDir: ctx.outDir });
  await ffmpeg.run(['-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-vf', `transpose=1,${EVEN}`, ...VIDEO_OUT[fmt], '-y', out], progress(ctx, info));
  return out;
}

async function normalize(src, ctx) {
  const info = await ffmpeg.probe(src);
  const fmt = editContainer(src);
  const out = outputFor(src, { ext: AUDIO_OUT[fmt].ext, suffix: ' Normalized', outDir: ctx.outDir });
  await ffmpeg.run(['-i', src, '-map', '0:a:0', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', ...AUDIO_OUT[fmt].args, '-y', out], progress(ctx, info));
  return out;
}

async function stripMetadata(src, ctx) {
  const info = await ffmpeg.probe(src);
  const out = outputFor(src, { ext: extOf(src), suffix: ' No Metadata', outDir: ctx.outDir });
  const maps = ['-map', '0:v?', '-map', '0:a?', '-map', '0:s?'];
  await ffmpeg.run(['-i', src, ...maps, '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-y', out], progress(ctx, info));
  return out;
}

/** Join several videos (letterboxed to the first one's size) or audio files. */
async function merge(files, ctx) {
  const infos = [];
  for (const f of files) infos.push(await ffmpeg.probe(f));
  const total = infos.reduce((a, i) => a + i.duration, 0);
  const anyVideo = infos.some((i) => i.hasVideo);
  const first = files[0];
  const args = [];
  files.forEach((f) => args.push('-i', f));
  const parts = [];
  let filter = '';
  if (anyVideo) {
    const base = infos.find((i) => i.hasVideo);
    const W = Math.max(2, Math.round((base.width || 1280) / 2) * 2);
    const H = Math.max(2, Math.round((base.height || 720) / 2) * 2);
    let silent = files.length;
    infos.forEach((info, i) => {
      if (!info.hasVideo) throw new Error(`${path.basename(files[i])} has no video`);
      filter += `[${i}:v:0]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}];`;
      if (info.hasAudio) {
        filter += `[${i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo[a${i}];`;
      } else {
        // concat needs an audio stream from every segment.
        args.push('-f', 'lavfi', '-t', String(info.duration || 0.1), '-i', 'anullsrc=r=48000:cl=stereo');
        filter += `[${silent}:a]anull[a${i}];`;
        silent++;
      }
      parts.push(`[v${i}][a${i}]`);
    });
    filter += `${parts.join('')}concat=n=${files.length}:v=1:a=1[v][a]`;
    const fmt = editContainer(first);
    const out = outputFor(first, { ext: VIDEO_OUT[fmt] ? fmt : 'mp4', name: 'Merged', outDir: ctx.outDir });
    await ffmpeg.run([...args, '-filter_complex', filter, '-map', '[v]', '-map', '[a]', ...VIDEO_OUT[fmt], '-y', out], { duration: total, onProgress: ctx.progress, signal: ctx.signal });
    return out;
  }
  infos.forEach((info, i) => {
    if (!info.hasAudio) throw new Error(`${path.basename(files[i])} has no audio`);
    filter += `[${i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo[a${i}];`;
    parts.push(`[a${i}]`);
  });
  filter += `${parts.join('')}concat=n=${files.length}:v=0:a=1[a]`;
  const fmt = editContainer(first);
  const out = outputFor(first, { ext: AUDIO_OUT[fmt].ext, name: 'Merged', outDir: ctx.outDir });
  await ffmpeg.run([...args, '-filter_complex', filter, '-map', '[a]', ...AUDIO_OUT[fmt].args, '-y', out], { duration: total, onProgress: ctx.progress, signal: ctx.signal });
  return out;
}

function tmpFile(ext) {
  return path.join(os.tmpdir(), `convertdrag-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
}

module.exports = {
  convert,
  compress,
  trim,
  mute,
  resize,
  snapshot,
  frameJpeg,
  rotate,
  normalize,
  stripMetadata,
  merge,
  tmpFile,
  probe: ffmpeg.probe,
  VIDEO_OUT,
  AUDIO_OUT,
  needsEvenScale,
};
