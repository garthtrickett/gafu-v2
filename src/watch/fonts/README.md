# Watch font

`noto-sans-jp-bold.woff2` is a WOFF2 subset of the Japanese Bold face (index 0)
in Noto Sans CJK 2.004's `NotoSansCJK-Bold.ttc`, copyright 2014–2021 Adobe.
It is licensed under the SIL Open Font License 1.1; see [OFL.txt](OFL.txt).

Source: https://github.com/notofonts/noto-cjk/releases/tag/Sans2.004

The subset includes Latin, kana, Japanese punctuation, BMP CJK ideographs,
compatibility ideographs, and fullwidth/halfwidth forms. It is independent of
any learner's subtitle file. Other scripts and rare supplementary ideographs
use the platform fallback. The browser loads this same-origin font only when
Watch renders subtitle text; no third-party font service sees local text.

Reproduce with FontTools 4.60.1 and its WOFF2 support (conversion tooling only,
not a Gafu runtime or build dependency):

```sh
pyftsubset NotoSansCJK-Bold.ttc --font-number=0 \
  --unicodes=U+0000-024F,U+2000-206F,U+3000-30FF,U+31F0-31FF,U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF,U+FF00-FFEF \
  --flavor=woff2 --output-file=noto-sans-jp-bold.woff2
```
