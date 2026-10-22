# Creating English-context → Japanese listening dialogues

Use this workflow when the learner asks for listening conversations, a playlist,
or an MP3 in the format established in earlier sessions. The agent writes
original scenes; deterministic tools check the language, synthesize speech,
assemble the track, and verify delivery. Speech synthesis does not write or
translate the dialogue.

The learner's goal is to understand conversational Japanese through relaxed
listening. Make the situation easy to picture, then let the Japanese carry the
conversation. The audio should work without reading, pausing, answering a quiz,
or trying to identify every word.

## 1. Get the learner's actual known language

- Prefer a fresh authenticated `GET /api/study/knowledge` from the relevant Gafu
  installation. Record when it was fetched and which installation it describes.
- Use the returned vocabulary and grammar, following Study's
  [`knowledgeSnapshot`](../src/study/study.ts): enabled Known Word Bank baseline
  entries plus vocabulary and grammar Cards with `support_ready_at` set.
- A staged Card, an active Card, a word seen once, or an entry in the
  conversational frequency list is not evidence that the learner knows it.
  Do not silently include the whole Card bank or frequency list.
- If using a SQLite backup, open it read-only and reproduce the same knowledge
  rules. Record the backup's date. An older saved snapshot can supply a
  conservative starting vocabulary, but must not be described as today's bank.
- Preserve lemma, reading, meaning, part of speech, source, and available sense
  information. A matching spelling alone does not prove the intended meaning is
  known. Fetching knowledge must not change Cards, schedules, or preferences.

**These dialogues have no planned new words or grammar.** The tale-writing
allowance for an occasional new word does not apply. If a scene needs language
outside this bank, change the scene or rewrite the line.

## 2. Write small, original scenes

For each scene, keep a stable ID, a short English title, English context, and an
ordered list of Japanese turns with separate speaker labels. Yuki and Shide are
the established pair; keep their identities and voices consistent within a
playlist.

- Start with about eight scenes. Check a small pilot before writing a whole
  hour; then work in manageable batches and validate each batch.
- Give roughly 30–50 words of plain English context: who is there, where they
  are, what has just happened, and what they are trying to do. Adjust the length
  to the scene. Do not read an English translation of every upcoming line.
- Follow it with around 4–6 short Japanese turns. Use natural reactions,
  questions, clarification, and replies that depend on what was just said.
- Prefer ordinary situations: meals, visits, errands, family, transport, small
  mistakes, plans, and helping someone. Vary the situation and conversational
  purpose. New playlists should contain new conversations, rather than the same
  exchange with nouns swapped.
- Do not default to anime, detective, or business scenes because those words
  appear in older Cards. The learner's current focus is everyday conversation.
- Keep sentences easy to process even when the learner knows every word. Avoid
  stacking clauses, unnecessary ambiguity, and artificial dictionary-definition
  sentences. Read the whole exchange for continuity and naturalness.
- Use familiar conversational forms where supported by the known grammar.
  Particles and conjugations are necessary Japanese; unfamiliar constructions
  must not be waved through as "just grammar."
- Keep speaker names in metadata and the transcript, rather than adding
  repeated "Yuki said" narration to the spoken Japanese.

A reusable authoring brief:

```text
Write original everyday mini-scenes for relaxed Japanese listening.
For each: stable ID, English title, short English situation, and 4–6 Japanese
turns labelled Yuki/Shide. The English establishes the situation; it does not
translate each turn in advance. Replies must form a coherent conversation.
Use only the vocabulary, meanings, and grammar in the attached dated Gafu
knowledge snapshot. Introduce no new learning targets. If an idea needs an
unknown word or construction, rewrite it. Keep the Japanese natural and short.
```

## 3. Audit the exact Japanese before paying for speech

Run every turn through the repository's Japanese analyzer and vocabulary and
grammar checks. Relevant building blocks include
[`createKuromojiAnalyzer`](../src/analysis/kuromoji-analyzer.ts),
[`classifyKnownVocabulary`](../src/analysis/known-vocabulary.ts), and the
[`declaredGrammarDetector`](../src/learning-material/declared-grammar.ts).
Follow Gafu's knowledge-matching policy when adapting the snapshot for a checker;
do not discard identity or sense information simply to obtain a pass.

Keep a private report keyed by scene/turn ID with the exact Japanese checked,
token analysis, raw vocabulary/grammar flags, and any specific review decisions.
The checks are evidence for review; they do not prove conversational naturalness
or detect every possible grammar construction.

For each flag:

1. **Genuinely unknown word or construction:** rewrite it using known language.
2. **Known inflection, spelling, or conversational contraction:** verify the root
   and the required construction are actually known, then document that exact
   form in its sentence. Do not globally allow arbitrary colloquialisms.
3. **Tokenizer or detector mismatch:** inspect the sentence, reading, meaning,
   and known entry. Rephrase where practical; otherwise record a narrow,
   evidence-backed explanation. Preserve the original flag.

Do not mark an unknown item known, weaken a validator, or add a blanket exception
to make a script pass. Read the English and Japanese together to catch meanings,
speaker turns, and scene details that disagree despite a clean lexical check.

After merging batches or editing any line, rerun the audit on the complete final
script. Speech generation must refuse unresolved flags and require an exact
ID/text match between the audit and the script it is about to speak.

## 4. Generate resumable audio

Use the existing authorized speech-credential flow. Prior authorization persists;
ask only if the needed access has not been authorized. Keep credentials out of
source, scripts, arguments, logs, transcripts, exports, and Git. Load them into
memory or the child process environment without printing them.

The established playlist defaults are:

| Part | Voice / setting |
| --- | --- |
| English narrator | Google `en-US-Neural2-F`, speaking rate `1.0` |
| Yuki | Google `ja-JP-Neural2-B`, speaking rate `0.95` |
| Shide | Google `ja-JP-Neural2-C`, speaking rate `0.95` |
| Intermediate audio | Mono, 24 kHz, 16-bit PCM |
| Final track | One continuous MP3, 128 kbps |
| After English context | 1.2 seconds |
| Between Japanese turns | 0.65 seconds |
| Between scenes | 3 seconds |

Keep these defaults unless the learner requests a change or a checked audio
sample gives a concrete reason. State once at the beginning that the voices are
AI generated. Speaker labels belong in the transcript; separate voices identify
the speakers in the audio.

Synthesize context and turns separately. Cache each completed utterance using
the text and all speech settings, including voice, language, rate, and format.
Write completed clips incrementally and atomically so a restart reuses paid
audio. A changed line needs only its own new clip.

Use bounded concurrency (the previous playlists used three requests). Retry
transient transport, rate-limit, and server errors with backoff. Inspect other
provider failures before retrying; do not expose credentials in diagnostics.
Check each returned clip's format, nonempty samples, and non-silent signal.
Assemble from an ordered manifest, never completion order. Balance voice levels
without clipping and stream the final encoding rather than keeping an hour of
uncompressed audio in memory.

## 5. Verify the finished playlist

- Check every English context and Japanese turn occurs once, in script order,
  with the correct speaker and cached request identity.
- Measure the actual encoded duration. For an hour request, reach at least
  60 minutes with new scenes, rather than repeated conversations or long silence.
  A previous 104-scene, 520-turn track ran 64:45; scene count is only an estimate.
- Use `ffprobe` to check the file's format and duration, and decode the whole MP3
  with FFmpeg to catch corruption. Check volume/clipping and spot-listen to
  context-to-dialogue transitions and both speakers.
- Produce a timestamped text transcript with English context and named Japanese
  turns. Include matching SRT cues and a chapter-time list when useful. Check
  timestamps are ordered and end within the audio's measured duration.
- Record the knowledge date, final script/audit identity, voices/settings,
  actual duration, scene/turn counts, output size, and checksum in a private
  manifest. Reused short responses are normal; check that whole conversations
  have not been copied from earlier playlists.

Keep scripts containing credentials out of the workflow entirely. Keep private
learner knowledge, authored scripts, audits, PCM clips, and generated audio in
the appropriate data/output home outside Git. This guide is a procedure, not a
claim that the historical per-playlist scripts are a maintained repository CLI.
After a checkout move, create and validate a successor with current source paths
before reusing an old launcher; preserve frozen historical evidence.

## 6. Deliver what the learner requested

For the established phone setup, publish completed MP3/transcript files into
`~/phone-media/japanese`, inside the existing **Phone media** Syncthing share.
The `japanese` directory is a subfolder; creating it does not require a new
Syncthing share or device pairing. Inspect the current share before changing it.

Copy through temporary files and rename atomically, then trigger a scan of the
subfolder. Publish the finished listening artifacts, not credentials, knowledge
snapshots, checker scripts, or intermediate PCM. Preserve existing files.

Verify the destination phone's completion and availability of the actual new
files. The server's own folder completion can describe unrelated phone-origin
files and is not proof of delivery. Say "ready to sync" if the phone has not
received them; say "synced" only after verifying it has. For downloads instead,
provide a link from the supported artifact host and verify it works before
reporting delivery.

Report the measured running time, scene count, knowledge snapshot date, and
delivery location/status. Keep the user-facing handoff short.

## Running the work on a shared machine

Follow the current shared-compute policy and inspect live resource capacity.
Run work that outlives a tool call through `work run`; for work over about ten
minutes, nest `systemd-run --user --scope --quiet`. Bound CPU/RAM and network
concurrency, write progress incrementally, and pair tracked jobs with `work wait`.
Send useful progress updates and inspect the process exit result. A printed log
marker is not proof that a job completed successfully.

For connected passages imported into Reading, use the separate
[passage-import format](./passage-import.md). Creating a listening MP3 does not
itself import a Reading or change SRS progress.
