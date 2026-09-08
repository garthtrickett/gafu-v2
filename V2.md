# Gafu V2 Product Requirements Document

**Status:** Working draft 0.6
**Last updated:** 2026-09-08

## Product direction

Gafu V2 starts with something the learner wants to understand, such as an
episode or complete series of a Japanese show, and prepares them for it through
explicit study.

The learner should not have to rely on picking up unfamiliar Japanese through
passive exposure. Gafu identifies the language that stands between the learner
and useful comprehension, turns the durable concepts into Cards, teaches those
Cards through spaced repetition, and then lets the episode reinforce them in a
memorable context.

> Choose something to watch. Learn what blocks understanding. Watch with the
> language already in reach.

## Core product model

### Card

A **Card** is the durable thing the learner is trying to remember. Every Card
has exactly one type:

1. **Grammar Card**
2. **Vocabulary Card**

There are no other Card types in V2. A subtitle line, generated question,
example sentence, audio clip, and episode encounter are learning material for a
Card; they are not additional Cards.

The Card is stable, but what the learner sees is not. Every study presentation
uses fresh AI-generated Learning Material based on the Card, the learner's
Known Word Bank, and the grammar they already know. This variation is essential:
the learner should remember the vocabulary or grammar itself rather than
memorize one fixed sentence.

Each learner has at most one review schedule for a Card. Finding the same Card
in another episode adds useful evidence and context without creating a second
schedule.

### Grammar Card

A Grammar Card teaches one reusable grammatical construction or function.

Its learning content must be able to communicate:

- the canonical form;
- its meaning or communicative function;
- how it is formed;
- relevant register, constraints, and common variants; and
- examples that isolate the grammar using vocabulary the learner already knows.

Different examples and exercises may be generated over time. Correctly
remembering one sentence must not be mistaken for knowing the grammar.

### Vocabulary Card

A Vocabulary Card teaches one lemma or fixed expression in one meaning.

Its learning content must be able to communicate:

- the canonical written form;
- reading;
- part of speech;
- the specific meaning being learned;
- relevant register and usage notes; and
- common inflected or observed surface forms.

The same spelling with meaningfully different senses requires separate
Vocabulary Cards. Stable identity claims deduplicate the same sense without
making editable display wording part of the Card's identity.

### Learning material

Learning Material is fresh AI-generated content used to teach or test one Card.
It may include a situational prompt, example sentence, furigana, explanation,
formation hint, or answer. Audio may be synthesized from the generated Japanese
after the material passes validation.

The Card owns the learner's progress. Learning material does not own a progress
schedule and may change between reviews.

Every generated presentation must:

- be generated specifically for the target Grammar Card or Vocabulary Card;
- actually contain and correctly use the target;
- be an `i` or `i+1` presentation: it contains only known language, or known
  language plus the one target Card as its sole unknown;
- draw every supporting word from the learner's Known Word Bank, with the target
  Vocabulary Card as the only permitted unknown word;
- use only grammar the learner already knows, with the target Grammar Card as
  the only permitted unknown grammar;
- freely use necessary Japanese particles, inflections, conjugations, and
  copulas when they do not introduce an additional teaching target;
- be natural and appropriate for the intended register;
- differ materially from recently shown material for the same Card; and
- pass deterministic structural, target-presence, and `i`/`i+1` validation
  before it is shown.

Generation failure must not silently produce an invalid review. Gafu may retry,
use another previously validated AI-generated presentation, or clearly report
that material is temporarily unavailable.

### Known Word Bank

The **Known Word Bank** is the learner's trusted pool of vocabulary they already
know. It begins with the Kaishi 1.5k vocabulary list, which is treated as known
baseline vocabulary rather than a set of Cards the learner must memorize again.

The bank tells AI generation which supporting words may safely appear without
creating extra learning work. It can grow as Vocabulary Cards become
support-ready, and the learner must be able to correct it when the baseline does
not match what they actually know. A Vocabulary Card becomes support-ready after
explicit confirmation or two successful recalls on different local days at
least 20 hours apart. Once earned, that trust remains until the learner
explicitly corrects it.

For a Grammar Card, all vocabulary comes from the Known Word Bank and the target
grammar is the only possible unknown. For a Vocabulary Card, the target word is
the only possible unknown word and all remaining vocabulary comes from the
bank. In both cases, non-target grammar must already be known. Once the target
itself is known, Gafu may generate an `i` presentation for reinforcement.

### Subtitle Set

A **Subtitle Set** is one or more ordered Japanese subtitle files that the
learner wants to prepare for together. The learner may select several files or
upload one ZIP archive containing them. A single episode is a valid Subtitle
Set; a whole season or series may also be one.

The files are source evidence, not Cards. Their episode boundaries and order
must be preserved so Gafu can prioritize language before its first important
appearance and report readiness per episode.

### Preparation Plan

A **Preparation Plan** is the learner-specific study path for a Subtitle Set.
The agent compares the vocabulary and grammar in the subtitles with the
learner's Known Word Bank, Card bank, and learning state to find the
**Preparation Gap**.

The plan reuses existing Cards and creates the missing Grammar Cards and
Vocabulary Cards selected for preparation. It puts unseen Cards into a staged
queue ordered by when and how often they matter. The existing SRS **New Cards
per Day** setting controls how many staged Cards enter study each day across
both Card types and every Card source. It never creates separate Cards for each
episode: repeated language across the Subtitle Set points to one Card and
increases its priority.

## Primary workflow

1. The learner chooses a show and supplies one or more Japanese `.srt` subtitle
   files, either as individual files or inside one `.zip` archive.
2. Gafu shows the detected episodes and their inferred order so the learner can
   correct missing, unsupported, or misordered files before analysis.
3. The agent analyzes vocabulary and grammar across the complete Subtitle Set.
4. Gafu compares the analysis with the learner's Known Word Bank, Card bank,
   and current learning state.
5. Gafu produces the Preparation Gap: comprehension-relevant vocabulary and
   grammar that is neither known nor already being learned.
6. Gafu ranks the gap by recurrence, comprehension value, reuse across the set,
   and how early each target is needed. It must not silently truncate the plan
   to a fixed number of targets.
7. The learner can correct the analysis, mark an item as already known, dismiss
   it, defer it, or include it in the Preparation Plan.
8. Starting the plan atomically creates the included missing Grammar and
   Vocabulary Cards, reuses existing Cards, and adds unseen Cards to the staged
   queue.
9. Gafu teaches the planned Cards before playback and shows progress for the
   overall Subtitle Set and each episode. Its completion estimate is derived
   from the current New Cards per Day setting and remaining review work.
10. During playback, the learner may select an unfamiliar word in a subtitle and
   use a Gafu keyboard shortcut to create its Vocabulary Card.
11. Later reviews test the Cards in varied contexts so that learning transfers
    beyond the episode.

## What “ready to watch” means

The goal is not necessarily to teach every token in the subtitles. Names,
sound effects, transparent loanwords, rare incidental language, and items that
do not materially affect comprehension may not justify a Card.

Subtitle analysis should classify unfamiliar language into three groups:

- **Required preparation:** likely to block comprehension and worth learning
  before playback.
- **Helpful preparation:** useful, but not required before starting the episode.
- **Incidental:** better handled by an optional lookup during playback.

The learner is ready for an episode when its required preparation Cards are
known or support-ready. The Preparation Plan may show
later episodes as not ready while an earlier episode is ready to watch. The
readiness threshold is actual learning state, not mere admission or exposure;
helpful Cards improve coverage but do not block playback.

Unlike V1's fixed syllabus of only a few new targets, V2 must be capable of
building a complete preparation path for a difficult episode or series. It may
take a week, two weeks, or longer depending on the Preparation Gap and the
learner's New Cards per Day setting. Gafu reports that forecast rather than
creating a separate pace control or promising mastery by a particular date.

## Card bank requirements

- The Card bank contains both Grammar Cards and Vocabulary Cards in one
  collection.
- Every Card has a stable identity and an explicit `grammar` or `vocabulary`
  type.
- A learner cannot acquire duplicate schedules for the same Card.
- Preparation analysis must consult the Card bank before proposing anything
  new.
- Already-known, dismissed, and currently-learning Cards must be distinguished.
- A Card may record that it appeared in multiple episodes without storing those
  episodes as separate Cards.
- Grammar and vocabulary may have different teaching content while sharing the
  same scheduling rules and learner-state vocabulary.
- The learner can browse, search, edit, suspend, and manually create Cards.
- Progress must survive application upgrades and must be recoverable without
  manually repairing browser storage.

## Learning requirements

- New Cards are explicitly taught before they are tested.
- A review isolates one uncertain Card at a time wherever practical.
- Grammar exercises use vocabulary and non-target grammar the learner already
  knows.
- Vocabulary exercises use supporting vocabulary and grammar the learner
  already knows.
- Every study presentation uses AI-generated Learning Material.
- Repeated presentations of one Card must vary their situation and Japanese
  sentence rather than repeating one memorized prompt indefinitely.
- Every presentation must satisfy the `i`/`i+1` constraint. The target Card is
  the only allowed unknown; a known target produces an `i` presentation.
- Supporting lexical content must remain inside the Known Word Bank, with the
  target Vocabulary Card as the only allowed lexical exception.
- Generation prompts alone are not sufficient enforcement. Gafu must analyze
  the returned Japanese and reject material containing an unknown supporting
  word or an unknown non-target grammar item.
- Recently used material must be tracked well enough to reject exact and
  near-copy generation for the same Card.
- Passive playback may record an encounter, but it does not by itself prove
  recall or mark a Card as learned.
- The learner can correct a bad definition, bad analysis, or mistaken Card
  match.

## Subtitle ingestion and preparation requirements

- The learner can create one Subtitle Set by selecting one or more `.srt` files
  directly or one `.zip` archive containing multiple `.srt` files.
- ZIP import must safely reject encrypted, corrupt, oversized, and unsupported
  entries and must never treat an archive path as a filesystem destination.
- Before analysis, Gafu shows every accepted subtitle file and its inferred
  episode order. The learner can reorder files, remove them, and correct titles.
- One bad file does not silently invalidate the others. Gafu reports the exact
  failed file and lets the learner correct it or continue without it.
- Subtitle parsing and linguistic analysis happen without uploading video or
  audio. Before subtitle text is sent to a remote agent, Gafu clearly identifies
  what will be sent and which configured provider will receive it.
- The agent identifies vocabulary by lemma and sense, grammar by canonical
  construction, and retains episode and cue evidence for each match.
- Gap calculation excludes vocabulary in the Known Word Bank and Cards the
  learner has already marked known. Existing New or Learning Cards are included
  in preparation progress but are never recreated.
- Gafu shows why each gap item matters, including total frequency, episodes in
  which it occurs, and its first important appearance, without forcing the
  learner to inspect every subtitle line.
- Repeated, cross-episode, early, and comprehension-critical material ranks
  above incidental material.
- The complete useful Preparation Gap remains available for inspection. Gafu
  must not silently reduce it to a fixed top-three, top-fifteen, or daily-sized
  result.
- The learner can choose to prepare only required Cards or include helpful
  Cards.
- Starting a Preparation Plan creates all included missing Cards atomically. If
  creation fails, Gafu does not leave a partially-created plan or duplicate
  schedules.
- New Cards are staged in priority order. Each day, the SRS admits no more than
  the learner's New Cards per Day setting across planned, manually created, and
  Subtitle Capture Cards combined.
- Changing New Cards per Day affects future admissions and immediately updates
  the Preparation Plan forecast; it does not rewrite past reviews or create a
  second plan-specific limit.
- Closing and reopening Gafu preserves the Subtitle Set, Preparation Plan,
  agent-analysis progress, Card staging order, and study progress.
- A later re-analysis can update the plan without duplicating Cards, resetting
  their learning state, or losing the learner's corrections.

## Initial Watch and SRS integration

The initial integration between Watch and SRS is deliberately narrow:
**Subtitle Capture**. While a subtitle is visible, the learner selects Japanese
text and presses a dedicated Gafu keyboard shortcut to add that vocabulary to
SRS as a new Vocabulary Card.

Selection alone has no Gafu side effect. Subtitle text retains normal browser
selection behaviour, and standard copy commands such as `Ctrl+C` and `Cmd+C`
must continue to copy the selected word, phrase, or sentence. The Card shortcut
must be separate from common browser, copy, and player shortcuts.

On Subtitle Capture, Gafu must:

1. read only the current Japanese selection and its subtitle context;
2. resolve an inflected or surface form to the intended vocabulary lemma and
   sense;
3. show a compact choice before writing if the selection maps to more than one
   plausible vocabulary item;
4. create one Vocabulary Card in the learner's SRS with a new-card state;
5. avoid creating a duplicate schedule when that Vocabulary Card already
   exists; and
6. give immediate, unobtrusive confirmation or a clear correction path.

The selected subtitle and cue provenance may help disambiguate the word and may
be recorded as evidence that the Card appeared in the episode. They do not
become a permanent sentence Card or replace the fresh AI-generated Learning
Material used for study.

For the initial integration, Watch does not automatically mine Cards, create
Grammar Cards, advance SRS progress, record passive encounters, or require a
lookup modal merely because text was selected. Those behaviours may be
considered separately after Subtitle Capture is proven.

The integration is successful when:

- selecting and copying an entire subtitle sentence behaves like ordinary text
  copying and causes no SRS write;
- selecting one vocabulary surface form and pressing the Gafu shortcut creates
  the intended new Vocabulary Card;
- capturing that vocabulary again does not create another Card or schedule;
- ambiguous selections can be resolved before the Card is created; and
- a failed capture leaves no partial Card behind and keeps the selection
  available for retry or copying.

## Non-goals for the first V2 slice

- Automatically translating every subtitle line.
- Creating a permanent sentence Card for every subtitle cue.
- Treating recognition during playback as proof of durable learning.
- Automatically adding every detected token to the Card bank.
- Making text selection itself create a Card or open a lookup.
- Rebuilding every V1 feature before validating the episode-preparation loop.
- Choosing the V2 technical architecture inside this product document.

## First vertical slice

The first V2 slice should prove the new product loop with a small multi-episode
Subtitle Set:

1. Import multiple `.srt` files directly or import the equivalent `.zip`.
2. Verify and correct the detected episode order.
3. Let the agent analyze vocabulary and grammar across the complete set.
4. Compare the result with a small Known Word Bank and local Card bank.
5. Produce one inspectable Preparation Gap divided into Grammar Cards and
   Vocabulary Cards without a fixed target-count cutoff.
6. Start a Preparation Plan that creates missing Cards and reuses existing ones
   without duplicates.
7. Stage new Cards in priority order and admit them using the existing New Cards
   per Day setting.
8. Study admitted Cards using validated `i`/`i+1` Learning Material.
9. Close and reopen the application with the Subtitle Set, Cards, schedules,
   Preparation Plan, staging order, and progress intact.
10. Reach a visible ready-to-watch state for at least the first episode.

Accounts, cross-device synchronization, hosted TTS, and the full player are not
required to prove this slice. AI generation and validation are required because
fresh generated Learning Material is part of the core learning loop.

## Initial success criteria

V2's foundation is successful when:

1. A real multi-episode Subtitle Set can produce one useful Preparation Plan
   divided into grammar and vocabulary.
2. Vocabulary in the Known Word Bank and already-known Cards are excluded from
   the Preparation Gap.
3. The learner can tell why each proposed Card is worth learning and where it is
   needed.
4. Existing Cards are reused rather than duplicated across episodes or plans.
5. Planned Cards enter study in priority order without exceeding the shared New
   Cards per Day setting.
6. The learner can see an updated preparation forecast and a clear path toward
   watching each episode.
7. Studied material remains attached to the Card rather than one source
   sentence.
8. Reviewing the same Card twice produces materially different valid `i` or
   `i+1` Learning Material using the Known Word Bank and known grammar.
9. The complete first vertical slice can be tested through one coherent product
   interface.

## Decisions made

### 2026-09-08 — Card types

- The durable study item is called a **Card**.
- A Card has exactly one of two types: **Grammar Card** or **Vocabulary Card**.
- Sentences and exercises are learning material for a Card rather than further
  Card types.

### 2026-09-08 — Generated learning material

- Every study presentation uses AI-generated Learning Material based on its
  target Card.
- Kaishi 1.5k seeds the learner's Known Word Bank and is treated as vocabulary
  they already know, not material they need to memorize again.
- Every presentation is `i` or `i+1`: the target Card is the only possible
  unknown, and all supporting vocabulary and grammar are known.
- The target Card owns progress; generated sentences and exercises do not.
- Material varies between presentations so success cannot come from memorizing
  one fixed sentence.

### 2026-09-08 — Initial Watch and SRS integration

- The initial integration is Subtitle Capture only.
- The learner selects Japanese subtitle text and invokes a dedicated keyboard
  shortcut to create a new Vocabulary Card.
- Highlighting remains side-effect free so ordinary word, phrase, and sentence
  copying continues to work.
- Subtitle context is evidence for resolving the vocabulary target, not a
  permanent sentence Card.
- Watch does not initially create Grammar Cards or update learning progress.

### 2026-09-08 — Multi-episode preparation and SRS staging

- A Subtitle Set may be one `.srt`, several `.srt` files, or a `.zip` containing
  them.
- The agent analyzes the complete set and calculates the Preparation Gap against
  the learner's Known Word Bank and Card state.
- One Preparation Plan can create missing Grammar and Vocabulary Cards for a
  whole series while deduplicating targets shared by several episodes.
- The full useful gap remains inspectable; analysis is not capped to the number
  of Cards that can be introduced in one day.
- Preparation Cards share the existing SRS New Cards per Day limit with all
  other new Cards. The plan does not own a separate pacing setting.
- A one- or two-week preparation period is an estimate derived from the staged
  queue and SRS setting, not a second schedule or guaranteed deadline.

### 2026-09-08 — Card identity and support readiness

- A Vocabulary Card represents one lemma or fixed expression in one meaning.
- Immutable, versioned identity claims deduplicate Cards independently from
  editable display content; future dictionary authorities may add a trusted
  claim without replacing a Card or its schedule.
- Explicitly marking a Card known makes it support-ready immediately.
- Otherwise, a Card becomes support-ready after two successful recalls on
  different learner-local days at least 20 hours apart.
- Support readiness remains trusted through a later lapse until the learner
  explicitly corrects it.

## Open product decisions

1. May an exact episode sentence appear during preparation or later review, or
   should it be reserved for natural playback?
2. What minimum state makes a required Card ready for playback: taught once,
   recalled once, or recalled after a delay?
3. How should Gafu estimate that an episode is sufficiently covered?
4. What evidence and threshold decide whether a gap item is required, helpful,
   or incidental?
5. Are Cards private to one learner, shared catalogue entries with private
   progress, or a mixture of both?
6. Is V2 permanently single-user, or must its first data model preserve a path
   to multiple accounts and cross-device synchronization?
7. Which parts of the existing context-first and ear-first study experience
   remain essential?
8. How many validated generated presentations should be prepared ahead of time
   so study can continue through an AI outage?
9. What exact similarity rule prevents a generated sentence from being an
    ineffective near-copy of recent material?
10. What archive size, file-count, subtitle encoding, and extraction limits are
    appropriate for a complete series import?
11. Should a new Preparation Plan include all required items by default, or ask
    the learner to select every Card before creation?
