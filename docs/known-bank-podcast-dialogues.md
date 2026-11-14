# Making podcast dialogue companions from Gafu's known bank

Use this process when the learner wants a real Japanese conversation adapted to
language they already know, followed by newly synthesized audio. The aim is to
help them process the sentence patterns of casual conversation, then return to
the corresponding original recording.

This is a separate authoring workflow from
[writing original listening scenes](listening-dialogues.md). The shared guide
supplies speech defaults and audio checks; this document adds source alignment,
structure preservation, adaptation review, and the current delivery procedure.
These are agent-operated steps, not an implemented Gafu import feature or a
maintained one-command tool.

## What a finished companion contains

- A short English situation, followed by Japanese dialogue in two distinct AI
  voices. Do not speak the English translation of each turn by default.
- A transcript with stable speaker labels and optional English meanings.
- An original/adapted comparison with source cue IDs, original time ranges,
  and explanations of changes in wording, structure, or meaning.
- Matching SRT cues timed to the **new audio** when subtitles are requested or
  useful. They cannot be used as replacement subtitles for the original audio.
- Private evidence tying the source, knowledge snapshot, final script, audit,
  speech settings, audio checks, and delivery together.

Begin with one coherent exchange, usually 30–90 seconds of original audio.
Do not expand to the whole episode before the learner has tried the pilot.
The generated track's duration will differ from the source excerpt.

## 1. Establish the source and preserve it

For a close adaptation, use a transcript supplied by the learner or material
whose license or permission permits the requested adaptation. A publicly
readable transcript is not itself evidence of that permission. Keep the source
and adaptation private; do not publish them to public hosting or Git.

Keep the original SRT/text and its source identity outside the repository.
Record the episode title and URL, source filename and checksum, transcript
provenance (human or automatic, if known), and original cue IDs and timings.
Identify which recording those timings match. Keep source corrections separate
from the supplied text.

Choose an exchange with enough context to stand on its own. Preserve its
question/answer relationships and references. If the automatic transcript has
an odd phrase, missing word, unclear speaker, or apparent contradiction,
compare that span with the matching original audio when available. Do not
silently turn an ASR guess into an authoritative quotation. Record unresolved
uncertainty and choose another excerpt if it prevents a reliable adaptation.

Use stable companion speaker names, normally Yuki and Shide. Map them to the
source speakers privately and record any uncertain attribution. These are
distinct synthetic voices, not imitations of the podcast hosts. Prefer a
two-speaker excerpt for that pair. If another speaker must remain, give them a
separate label and distinct voice; do not silently merge their statements into
one of the other speakers. Record the additional voice settings. Remove podcast
introductions, advertising, and proper names if they are unnecessary and cannot
be supported by the learner's bank; record omissions in the alignment.

## 2. Fetch the actual known language

Use authenticated, read-only `GET /api/study/knowledge` from the intended Gafu
installation. Follow [knowledgeSnapshot](../src/study/study.ts), including
enabled baseline vocabulary and Cards with `support_ready_at` set. A staged
Card, a Card merely admitted to study, or a word in a frequency list does not
make it known.

Record the installation, learner identity where applicable, UTC fetch time,
`correctionRevision`, snapshot checksum, and vocabulary/grammar counts. Preserve
the full vocabulary entries: identity, written form, reading, part of speech,
meaning, source and sense IDs. Preserve the learned grammar entries too.
Counts alone are not an audit input, and a matching spelling alone is not a
matching sense.

Use a fresh snapshot for each new production run. When resuming an interrupted
run, retain its original snapshot and check for changed knowledge before
publication. If relevant words, meanings, senses or grammar were removed or
corrected, re-audit the final script against the new snapshot. Do not treat
`correctionRevision` alone as a fingerprint of every knowledge change. Record
both snapshot identities and which one the delivered version uses. If a fresh
snapshot cannot be fetched, state the saved snapshot date and limit the claim
to that snapshot; do not describe it as the current bank.

Fetching knowledge must not change schedules, mark words known, admit Cards,
change preferences, or trigger sentence generation. Load already-authorized
credentials privately; do not place passwords or provider keys in scripts,
command arguments, logs, transcripts, documentation, or Git.

## 3. Adapt each turn in this order

**Preserve the sentence structure wherever the known language allows it.**
Work from the source turn, not from an English translation that gets translated
back into new Japanese. The authoring agent writes the adaptation; speech
synthesis only reads the approved script.

1. Keep the turn unchanged if its vocabulary, meanings and grammar are known.
2. Substitute an unfamiliar content word or expression with a familiar one,
   keeping word order, particles, inflections and conversational endings where
   grammatical and natural.
3. Simplify a phrase if a direct substitution is unnatural or changes the
   participants' roles, implication or intended sense.
4. Change a construction only when required by unknown grammar, an unreliable
   source fragment, or naturalness. Record the construction and why it changed.
5. If the result needs substantial rewriting, select a more suitable excerpt
   or label it as a looser companion. Do not claim a close adaptation when the
   original structures have largely disappeared.

Keep reactions, backchannels, ellipsis, quotes, casual endings, and connected
turns where supported. Do not regularize everything into complete textbook
sentences. Avoid adding filler just to increase the track's length.

Check each substitution in its whole sentence. A synonym may take different
particles or a different complement. Also check collocations, register,
transitivity, tense/aspect, negation, comparison, quotation and agency. Preserve
the source's conversational purpose: a question must still invite the reply
that follows, and a quoted opinion must still belong to its original speaker.

There are **no planned new words or grammar**. This applies to reactions,
discourse markers, counters, names, idioms, and contracted forms as well as
ordinary nouns and verbs. Recognizing a root does not establish knowledge of
every derived sense or construction. For example, knowing a word for the moon
does not establish a month-counter use of the same character. Do not introduce
new language merely to preserve an exact date or incidental detail.

Some substitutions will broaden or alter details. Record these explicitly:
exact interval → a long time; specific date → a season; technical expression →
an everyday description. Keep the altered details consistent across all turns.
Do not let the English context or meaning claim more than the adapted Japanese
says. If losing a detail breaks the point of the exchange, choose another span.

For each adapted turn, keep:

| Field | Purpose |
| --- | --- |
| Stable turn ID and speaker | Audit and speech identity |
| Source cue IDs and time range(s) | Locate the corresponding original |
| Original text, unchanged | Review the actual substitution |
| Final adapted Japanese | Exact text to validate and speak |
| English meaning | Meaning of the adapted turn, including omissions |
| Change notes | Words/grammar changed, reason, and lost nuance |

Allow several source cues to form one turn, or one cue to become multiple
turns. Preserve their explicit mapping; do not invent word-level source
timestamps. Record omitted source cues separately.

## 4. Audit the exact final Japanese

Use the repository's actual
[Kuromoji analyzer](../src/analysis/kuromoji-analyzer.ts),
[known-vocabulary classifier](../src/analysis/known-vocabulary.ts), and
[declared-grammar detector](../src/learning-material/declared-grammar.ts).
Preserve identity/sense restrictions when adapting exported knowledge to these
interfaces. Do not assign every entry `allSenses` simply to get a pass.
If the export or analyzer cannot resolve a sense, review the exact usage
against the saved entry; rewrite an ambiguous or unsupported usage.

Keep the raw token analysis, raw vocabulary and grammar flags, and a separate
decision for every flag, keyed to the exact turn ID/text and relevant span.
Decisions must identify the supporting snapshot entry or known grammar form,
or explain why the flagged span is not a vocabulary/grammar occurrence.
Preserve the analyzer's normalized text, normalization version, span unit and
raw-boundary mapping. Its spans use UTF-16 code units in normalized text, not
Unicode character counts or byte offsets in the original string. Preserve the
grammar detector's span metadata too; do not slice a Python string using
JavaScript offsets without converting them.

- **Unknown word, sense or construction:** rewrite and recheck.
- **Known inflection, variant spelling or contraction:** identify the known
  lemma and the learned construction, with the exact contextual reading.
- **Tokenizer/detector mismatch:** retain the flag and explain this occurrence
  narrowly. Do not globally allow its surface text or a whole class of tokens.
- **Uncertain case:** keep it unresolved; do not purchase speech for that
  version.

Common mismatches include a contracted `ている` being tokenized as a separate
verb, explanatory `ん` being labeled a noun, punctuation labeled as a word,
and a detector finding `ても` inside an unrelated adverb. These are examples to
investigate, not pre-approved exemptions. Likewise, a grammar alias must map
to the same learned construction, not just share a suffix.

Manually review each complete turn and the conversation after the automated
checks. The detector does not enumerate every construction, and skipping
particles/auxiliaries during lexical classification does not approve their
grammar. Check senses, idioms, contractions and speaker coherence even when
there are no raw flags.

Approval requires no unresolved flags, reviewed naturalness, and reviewed
source alignment. Save the final script checksum, snapshot checksum, audit
identity, and exact ordered turn IDs/text. The speech step must reject a
script/audit mismatch. After any Japanese edit, rerun the audit on the complete
final script; refresh approval identity after any other script change too.
Never reuse an approval for text that merely has the same filename.

## 5. Generate the context and companion audio

Write a brief English setup from the **adapted** exchange: who is talking, what
has happened, and what they are discussing. Keep it around 20–50 words, without
translating every reply in advance or revealing details the adaptation removed.
State once that the voices are AI generated. Keep speaker labels in the
transcript rather than reading them before each line.

Follow [the shared speech defaults and caching steps](listening-dialogues.md#4-generate-resumable-audio):
English narrator `en-US-Neural2-F` at 1.0, Yuki `ja-JP-Neural2-B` and Shide
`ja-JP-Neural2-C` at 0.95, 24 kHz mono PCM intermediates, and a 128 kbps MP3.
Keep the established pauses unless the pilot gives a reason to adjust them.

Use the existing authorized Gafu speech-credential flow. Earlier authorization
persists; do not repeatedly ask for it. Read keys into memory without printing
the enclosing provider configuration. Speech receives only the approved text
and settings, not the whole known bank or source episode.

Cache each utterance by its exact text and speech settings. Save successful
clips atomically and assemble them in script order. Bound concurrency and
retry transient failures with backoff; do not blindly retry authentication or
configuration failures. A restart must reuse already-paid clips. Changed
wording requires regenerating only the changed utterance, then rebuilding the
track and its timestamps.

Keep the original podcast audio and the synthesized companion separate. Do
not claim they have matching timing or that the hosts said the adapted wording.
Do not append the original recording to a download by default.

## 6. Validate and package

- Check each approved turn and its assigned voice appears once and in order.
  Check the English setup against the final adapted conversation.
- Measure the actual encoded duration, size, sample rate and channels with
  `ffprobe`; decode the entire MP3 with FFmpeg. Check clips are nonempty and
  non-silent, and check the final signal for clipping and balanced levels.
- Spot-listen to the setup-to-Japanese transition, both voices, and any suspect
  pronunciation if audio listening is available. If it is unavailable, report
  that limit; do not claim a listening check from byte/volume checks alone.
- Generate transcript timestamps and optional SRT from actual synthesized clip
  lengths and inserted pauses. Check cue order, non-overlap and end time against
  the final audio. Retiming a clip means rebuilding these outputs.
- Include the source/adapted comparison in the private working package. Offer
  it as a separate optional learner-facing file through the same private
  delivery channel; it is not part of the playback transcript. Raw snapshots
  and audit reports remain private working evidence.
- Record checksums, byte sizes, measured duration, ordered clip identities,
  voices/settings, knowledge date, script/audit identities and checks performed
  in a private manifest. A source excerpt's length is not the generated length.

Store source files, snapshots, scripts, audits, clips and outputs outside Git,
in a task-specific private directory (directory mode 700, private files 600).
Repository documentation may describe the process, but must not contain the
learner's bank, real transcript bodies, credentials or generated private content.

## 7. Deliver to the phone

Use the current Infra instructions:

- `/home/gust/code/infra/docs/phone-media-delivery.md`
- `/home/gust/code/infra/docs/phone-media-https.md`
- `/home/gust/code/infra/docs/phone-media-push.md`

The destination is the phone's existing `phone-media/japanese` folder. The
current publisher is Notes' authenticated delivery queue; merely copying files
to `~/phone-media/japanese` uses the legacy path. Leave retired Syncthing paused.

Verify the final file against its manifest, then publish the finished MP3 and
playback transcript (plus subtitles if useful):

```sh
phone-media-delivery publish '/absolute/path/companion.mp3' \
  --path 'japanese/Podcast - Known-bank companion.mp3'
phone-media-delivery publish '/absolute/path/companion.txt' \
  --path 'japanese/Podcast - Known-bank companion.txt'
```

Record each returned delivery ID, destination, size and checksum privately.
Use the existing push/receipt services. Do not start a new watcher, change
phone journals or TLS credentials, or republish pending files to force a retry.
Publish only finished learner-facing files, not bank snapshots, audit reports,
credential-bearing configuration or PCM caches.

Distinguish **queued**, **phone stored**, and **server cleanup acknowledged**.
Check the real matching stored receipt and normal cleanup acknowledgement for
each delivery ID. Push acceptance, a server copy disappearing, or a successful
host-side fetch alone does not prove phone storage. Never manufacture a receipt.
Report playback as verified only with actual playback evidence.

If still queued, direct the learner to **Notes → Audio → Fetch media → Fetch
now**. Report that phone confirmation is pending. Keep failed/pending originals
and rely on the normal verified receipt cleanup, not manual payload deletion.

For an explicitly requested browser download, verify the actual downloaded
file's bytes/type and checksum, not only HTTP success or a filename. An expired
token can produce a tiny error document saved as `.mp3`. Local filesystem links
and one-minute, one-use capability URLs have failed in this workflow; prefer
the established phone delivery when that is the requested destination. Do not
upload this private source/adaptation to an unrelated public file host.

## Completion and the next step

Hand off the measured duration, source excerpt range, knowledge date, actual
delivery status and where to find the files. Mention material meaning/structure
changes and limits of validation without claiming guaranteed comprehension.
Suggest the corresponding original section after the learner tries the easier
companion. Wait for feedback before expanding the episode or making an hour.

Follow the shared-compute policy before substantial analysis/encoding. Track
jobs that outlive a tool call with `work run` and a paired `work wait`, bound
CPU/RAM/concurrency, and preserve resumable outputs. Revalidate old private
scripts against the current checkout and data paths before reusing them.
