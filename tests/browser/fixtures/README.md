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

The browser journeys use it to run the real FFmpeg WASM conversion and Opus
playback without a system FFmpeg dependency in CI.
