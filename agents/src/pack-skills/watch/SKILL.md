---
name: watch
description: Inspect and analyze video media from local files or URLs. Downloads streams with yt-dlp, extracts auto-scaled keyframes with ffmpeg, extracts audio tracks for speech transcription, and synthesizes timecoded summaries.
---
# Video Inspection & Scene Analysis (Watch)

Inspect local video files or external URLs, extracting visual keyframes, closed captions, and audio transcripts for accurate analysis.

## First: are the tools here?

Run `which ffmpeg ffprobe yt-dlp` (it only reads). The standard VESPR sandbox image has none of them, and no speech-to-text. If they are missing:
- Say so plainly. Do not describe a video you did not watch or hear; an attached video can only be described by its header (the read_attachment notes say what was not read).
- Downloading with yt-dlp reaches the internet, so it needs an approval; ask for one command at a time.
- Frames and audio a command extracts are binary and are not shared back into the workspace. Report timecoded findings as text.

## Processing Pipeline

1. **Stream & Header Inspection:**
   - Inspect container format, duration, video codec, and resolution with `ffprobe`:
     ```bash
     ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,duration -of json input.mp4
     ```

2. **Automated Keyframe Extraction:**
   - For scene-level visual inspection, extract downscaled representative keyframes:
     ```bash
     ffmpeg -i input.mp4 -vf "fps=1,scale=640:-1" -q:v 3 frames_%04d.jpg
     ```
   - For fast scanning, use scene change detection to extract frames only when visual content transitions:
     ```bash
     ffmpeg -i input.mp4 -vf "select='gt(scene,0.3)',scale=640:-1" -vsync vfr scene_%03d.jpg
     ```

3. **Audio Extraction for Transcription:**
   - Extract a 16 kHz mono uncompressed WAV stream for speech recognition:
     ```bash
     ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 /tmp/audio.wav
     ```
   - Prioritize native embedded closed captions (`yt-dlp --write-sub --sub-lang en`) whenever available before running audio transcription models.

4. **Evidence-Based Reporting:**
   - Always cite exact timestamps (`[MM:SS]`) when referencing visual elements, on-screen text, or spoken statements.
   - Do not hallucinate visual facts from audio alone; verify against extracted keyframes.

