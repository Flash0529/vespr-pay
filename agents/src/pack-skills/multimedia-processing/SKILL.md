---
name: multimedia-processing
description: Inspect, analyze, extract frames, transcribe, convert, and generate video and audio files using ffmpeg, ffprobe, and Web Audio/Canvas APIs in the runner.
---
# Multimedia Processing & Analysis

Handle audio, video, and animation assets cleanly in the workspace sandbox runner.

## First: are the tools here?

Run `which ffmpeg ffprobe` (it only reads). The standard VESPR sandbox image does not include them. If they are missing:
- Say so plainly. Never claim to have watched, heard or converted a file you could not open.
- Ask the room to pick a runner on a machine that has ffmpeg, or give the exact commands for a person to run.
- Video, audio and image files a command makes are binary and are not shared back into the workspace (nor is any file over 200 KB). Keep results as text: durations, codecs, frame counts, timecoded notes, JSON peaks.
- A command may run for 60 seconds, so keep every run short.

## Audio & Video Inspection

Before modifying or converting media files, inspect headers, stream properties, codecs, and durations using `ffprobe`:
```bash
ffprobe -v error -show_entries format=duration,size,bit_rate -show_streams -of json input.mp4
```
- Report codec (`h264`, `vp9`, `aac`, `opus`), resolution, frame rate, duration, and channel layout.
- Check audio sample rate (standard: 44.1 kHz or 48 kHz, 16-bit or 24-bit PCM).

## Video Frame Extraction for Analysis

When analyzing or debugging video playback, extract representative keyframes at regular intervals:
```bash
# Extract 1 frame per second as PNGs into an output directory
ffmpeg -i input.mp4 -vf "fps=1" frame_%03d.png
```
- Inspect frame sequence for artifacts, rendering glitches, or unexpected blank screens.
- Generate animated previews or lightweight WebP thumbnails from extracted frames.

## Audio Transcription & Speech Workflows

- Extract mono 16 kHz WAV audio tracks for transcription pipelines:
  ```bash
  ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 audio.wav
  ```
- Generate visual waveform data (e.g. JSON peak arrays or SVG curves) for UI playback scrubbers and audio meters.

## Media Generation & Synthesis

- Synthesize audio waveforms or TTS streams using connected models or standard command-line tools.
- Stitch generated slides, still images, and audio tracks into concise presentation clips:
  ```bash
  ffmpeg -loop 1 -i slide.png -i voice.wav -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest output.mp4
  ```
- Always respect sandbox limits: avoid unbounded transcoding runs, set timeouts, and clean up intermediate scratch files.
