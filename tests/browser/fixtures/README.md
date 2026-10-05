# Synthetic local media

`firefox-mkv.mkv` is two seconds of a blue frame and a generated 440 Hz tone.
It contains VP8 video and AAC audio; it contains no third-party media.

Generate it with:

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i color=c=blue:s=160x90:r=10 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 2 -c:v libvpx -b:v 30k -c:a aac -b:a 32k firefox-mkv.mkv
```

`firefox-stereo-flac.mkv` is two seconds of a blue frame with independent
440 Hz and 660 Hz tones in the left and right channels, encoded as 16-bit
48 kHz stereo FLAC. It reproduces the pinned WASM Opus encoder crash reported
for a real MKV without including any third-party media.

Generate it with:

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i color=c=blue:s=160x90:r=10 \
  -f lavfi -i 'aevalsrc=0.1*sin(2*PI*440*t)|0.1*sin(2*PI*660*t):s=48000' \
  -t 2 -c:v libvpx -b:v 30k -c:a flac -sample_fmt s16 firefox-stereo-flac.mkv
```

The browser journeys use these to run the real FFmpeg WASM conversion and Vorbis
playback without a system FFmpeg dependency in CI.
