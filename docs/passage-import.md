# Importing a passage into Reading

In **Read a tale**, choose **Import a passage** and select a UTF-8 JSON file.
The passage opens immediately and stays in the Reading list after a restart.
It displays connected Japanese sentences in paragraphs, with furigana above
kanji. Each paragraph's English is available through **Show English**.

```json
{
  "format": "gafu-passage",
  "version": 1,
  "title": "川の話",
  "titleReading": "かわのはなし",
  "titleEnglish": "A river story",
  "paragraphs": [
    [
      {
        "japanese": "女は川に行く。",
        "english": "The woman goes to the river.",
        "segments": [
          { "written": "女", "reading": "おんな" },
          { "written": "は", "reading": "は" },
          { "written": "川", "reading": "かわ" },
          { "written": "に行く。", "reading": "にいく。" }
        ]
      },
      { "japanese": "女は川を見る。", "english": "She sees the river." }
    ],
    [
      { "japanese": "女は川に行く。", "english": "She goes there again." }
    ]
  ]
}
```

Each inner array is one paragraph. Each item is one sentence, with its English
meaning. `titleReading` and `segments` are optional. When `segments` are omitted,
Gafu derives furigana from its Japanese analyzer. To supply a reading yourself,
split the sentence into ordered `written`/`reading` segments as shown above. The
written segments must rejoin into the sentence, and the reading must fit its
written form.

Gafu checks every sentence against the learner's known words. If any sentence
uses an unknown word or has invalid structure, the entire import is refused and
the error names the sentence. This import creates a Reading, not a Study Card,
so it does not change the review schedule. Importing the same file again keeps
one library entry.
