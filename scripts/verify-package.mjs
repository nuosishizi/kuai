import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const root = path.resolve(process.argv[2]);
const win = process.platform === 'win32';
const runtime = win ? path.join(root, 'Modules/EditorRuntime') : path.join(root, 'Contents/Resources/EditorRuntime');
const editor = path.join(runtime, 'editor-desktop');
const node = win ? path.join(root, 'runtime/node/node.exe') : path.join(runtime, 'runtime/node');
const media = path.join(runtime, 'media');
const ffmpeg = path.join(media, win ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobe = path.join(media, win ? 'ffprobe.exe' : 'ffprobe');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'quickcut-package-smoke-'));
const expected = JSON.parse(fs.readFileSync(path.join(editor, 'package.json'))).version;
const env = { ...process.env, PATH: win ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : '/usr/bin:/bin:/usr/sbin:/sbin',
  QUICKCUT_SUPPORT_ROOT: path.join(temp, 'support'), QUICKCUT_MEDIA_ROOT: media, QUICKCUT_NO_WINDOW: '1' };
delete env.DYLD_LIBRARY_PATH;
delete env.DYLD_FALLBACK_LIBRARY_PATH;
delete env.NODE_PATH;
const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { cwd: temp, env, encoding: 'utf8', timeout: 90000, windowsHide: true, ...options });
  assert.equal(result.status, 0, `${file}: ${result.error || result.stderr}`);
  return result.stdout;
};
for (const file of [node, ffmpeg, ffprobe, win ? path.join(root, '快剪.exe') : path.join(root, 'Contents/MacOS/QuickCut')]) {
  assert.ok(fs.existsSync(file), `Missing packaged component: ${file}`);
  if (!win) assert.ok(fs.statSync(file).mode & 0o111, `Not executable: ${file}`);
}
assert.equal(run(node, ['--version']).trim(), 'v22.18.0');
run(ffprobe, ['-version']);
const filters = run(ffmpeg, ['-hide_banner', '-filters']);
for (const filter of ['subtitles', 'afftdn', 'arnndn', 'crystalizer', 'deesser']) assert.match(filters, new RegExp(`\\b${filter}\\b`));
fs.writeFileSync(path.join(temp, 'captions.ass'), `[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 180\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,QuickCut smoke\n`);
run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-vf', 'subtitles=captions.ass', '-af', 'afftdn=nr=10:nf=-42', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'smoke.mp4']);
const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', 'smoke.mp4']));
assert.ok(probe.streams.some(s => s.codec_type === 'video'));
assert.ok(probe.streams.some(s => s.codec_type === 'audio'));
assert.ok(Number(probe.format.duration) >= 0.9);
const html = fs.readFileSync(path.join(editor, 'src/ui.html'), 'utf8');
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
const child = spawn(node, [path.join(editor, 'src/main.mjs')], { cwd: editor, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', errors = '';
child.stdout.on('data', b => { output += b; });
child.stderr.on('data', b => { errors += b; });
try {
  const deadline = Date.now() + 45000;
  while (!output.includes('QUICKCUT_EMBED_PORT=') && Date.now() < deadline && child.exitCode === null) await new Promise(r => setTimeout(r, 150));
  const port = output.match(/QUICKCUT_EMBED_PORT=(\d+)/)?.[1];
  assert.ok(port, `Packaged server did not start: ${output}\n${errors}`);
  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10000) }).then(r => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.version, expected);
  const page = await fetch(base).then(r => r.text());
  assert.ok(page.includes('QuickCut'));
  const rpc = async (name, args = []) => {
    const response = await fetch(`${base}/rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.value;
  };
  assert.equal((await rpc('ping')).version, expected);
  const project = await rpc('createProject', [{ name: 'Package smoke', ratio: '16:9' }]);
  assert.equal((await rpc('loadProject', [project.id])).id, project.id);
  await rpc('deleteProject', [project.id]);
  console.log(JSON.stringify({ verified: true, version: expected, platform: process.platform, arch: process.arch, node: '22.18.0', media: 'H264/AAC + ASS + denoise', health: true, projectRpc: true }));
} finally {
  if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
  fs.rmSync(temp, { recursive: true, force: true });
}
