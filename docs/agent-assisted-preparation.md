# Agent-assisted preparation

How an episode becomes Cards when an agent reads the subtitles, instead of the
Preparation page doing it. This is a second route to the same destination, not a
replacement: it produces ordinary Cards through the ordinary route, and Study
cannot tell which way they arrived.

## Why it exists

Preparation splits into two stages. The first is local, deterministic and free:
parse the SRT, tokenise, detect grammar, compare against the Known Word Bank and
existing Cards. The second asks a provider for per-candidate evidence under
exact-set-equality verification, which is expensive and brittle.

This route keeps the first stage and replaces the second with an agent reading
the episode. It is not automatic and does not scale to a series; it is for when
you want a considered set of Cards for one episode now.

## The division of labour

The split is the point, and it decides what the scripts are allowed to do.

**The tools establish facts that are tedious or unreliable to establish by eye.**
Every cue, every token with its lemma, reading and part-of-speech tags, how often
each form occurs, and — most valuable — which forms are already covered by the
Known Word Bank or an existing Card. That last check removed 168 of 423 distinct
words on the first episode run. No reader can do that reliably against 1,437
entries.

**The agent decides what is worth a Card and what each entry means.** Nothing in
the repository can produce an English meaning: `data/kaishi-1.5k.local.json`
holds meanings only for words already known. A dictionary is not used either,
because the cue and its neighbours give the sense actually in use, with the
example sentence and the register attached.

**The scripts must not pre-filter on worth.** An early version dropped tokens
tagged `名詞/接尾` before anything saw them, which silently hid 放題 — the word
behind the episode's central joke. Show everything with its tags and let the
reader cut.

## The route

### 1. Scan

```sh
GAFU_ACCESS_PASSWORD=... bun run subs:scan <file.srt>...
```

Reads the file, signs in, fetches Cards and Known Words, and prints every
distinct form with its tags, its frequency, and one cue. Calls no provider and
writes nothing.

Keep the subtitle file outside the repository. `AGENTS.md` forbids committing
subtitle bodies from copyrighted media, and the scan quotes cue text.

### 2. Read the episode

Not just the candidate list. The tokeniser cannot surface a multi-token idiom,
so 間が悪い, 元も子もない, 私としたことが and 我ながら never appear in any
candidate list — and all four block comprehension of the line they are in. They
were found only by reading the episode end to end.

### 3. Pull context for the shortlist

```sh
bun run subs:context <file.srt> -- 放題 見極め 気合
```

Every occurrence with the cue either side. This is where meanings come from.
It settled 気合 as the idiom 気合が入る, and separated おごり (complacency) from
奢る (to treat) — two entries the scan listed apart and a headword would merge.

Sahen verbs carry a `〜する` lemma, so ask for `油断する`, not `油断`.

### 4. Write a proposal file

Outside the repository, as JSON with `vocabulary` and `grammar` arrays matching
`VocabularyContent` and `GrammarContent`. Writing it down rather than leaving the
selection in a conversation makes it reviewable, diffable and re-runnable.

Idioms belong in `grammar`, not `vocabulary`: `formation` can carry why the
phrase means what it does — 元 (principal) も 子 (interest) も ない — which is
what makes an idiom stick.

### 5. Review, then add

```sh
bun run cards:add <proposal.json> --dry-run
GAFU_ACCESS_PASSWORD=... bun run cards:add <proposal.json>
```

Posts through `POST /api/study/cards`, the same route the browser uses, so
canonical identity, deduplication and scheduling stay with Study. An existing
Card is reported as `existing`, so re-running is safe and is how to resume a
partial run.

## Choosing what earns a Card

The criterion is what blocks comprehension of *this episode*, which is not the
same as what is worth learning in general. Frequency ranking works against it:
it surfaces パンダ and ケーキ while 見極め sits at one occurrence.

Judged by comprehension, the plot-critical words are often ordinary ones —
モテる, 癒やし系 and つきあう carry the entire romance thread — while an
interesting rare word may be peripheral. 紅茶 was dropped for exactly that
reason.

## What the tools get wrong

Check these rather than copying them.

**Readings are of the surface, not the dictionary form.** `token.lemma` is the
dictionary form but `token.reading` is the inflected reading, so 忘れる arrives
paired with わすれ. Observed errors: 破れる read as われる, 無頓着 as むとんじゃく.

**The same defect lives in the app.** `projection.ts` `relationFor` and
`known-vocabulary.ts` `sameForm` both compare lemma and reading as a pair, so an
inflected occurrence of a known word does not match. Measured over ordinary
conversational Japanese, 12 of 34 words in the Known Word Bank were classified
as gaps. The scan therefore matches on lemma and part of speech only, and
Preparation over-reports its gap until this is fixed.

**Tags are sometimes wrong.** ムリ came back as `固有名詞/地域`, キミ as `人名`.

**Unrecognised symbol runs are filed as nouns.** `!?` and `...♪` arrive as
`名詞/サ変接続`. Preparation excludes them; they are not Japanese to learn.

## Credentials

`GAFU_ACCESS_PASSWORD` is the deployment's sign-in password and both scripts
need it. Keep it outside the repository — an environment file at
`~/.gafu-env`, sourced before running. It is never written to a file the
scripts produce.
