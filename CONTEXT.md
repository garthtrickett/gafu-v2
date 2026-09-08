# Gafu Learning Context

Gafu helps a learner explicitly acquire the Japanese needed for media they want
to understand. This glossary defines the product language used by Gafu V2.

## Language

**Card**:
A durable item the learner is trying to remember, with exactly one card type and
at most one learner-specific review schedule.
_Avoid_: Knowledge point, rule, flashcard sentence

**Identity Claim**:
A stable assertion that a Card represents one particular vocabulary sense or
grammar construction. Several trusted claims may identify the same Card, but one
claim can never identify several Cards.
_Avoid_: Display name, mutable Card content, database key

**Card State**:
The learner-owned place of a Card in study: staged, active, known, or suspended.
It is distinct from the scheduler's private learning state.
_Avoid_: Knowledge-point status, FSRS state, Card type

**Grammar Card**:
A Card for a reusable Japanese grammatical construction or function. Its
examples may change without changing the Card.
_Avoid_: Grammar point record, grammar sentence

**Vocabulary Card**:
A Card for one Japanese lemma or fixed expression in one meaning. Inflected and
surface forms are evidence for the same Card rather than separate Cards.
_Avoid_: Word record, token card

**Learning Material**:
A fresh AI-generated presentation that teaches or tests one Card without owning
the learner's progress.
_Avoid_: Card, permanent sentence, saved flashcard

**Validated Presentation**:
Learning Material that passed Gafu's local structure, target, `i`/`i+1`, and
variation checks and is therefore eligible to be shown.
_Avoid_: Provider response, generated draft, trusted AI output

**Presentation Permit**:
An opaque, expiring, target-bound capability issued for one validated review
presentation. Study must consume it when recording the answer.
_Avoid_: Validation flag, schedule token, reusable session ID

**Validated Reserve**:
An unshown Validated Presentation retained locally so a brief provider outage
does not interrupt an already-started study session.
_Avoid_: Fixed fallback sentence, rejected generation, review history

**Known Word Bank**:
The learner's trusted pool of already-known vocabulary. It begins with Kaishi
1.5k and supplies the supporting words used to generate Learning Material.
_Avoid_: Generation Word Bank, Card bank, vocabulary deck

**Support-ready**:
A learner-owned fact indicating that a Vocabulary or Grammar Card is trusted as
supporting language in Learning Material, either by explicit confirmation or
successful delayed recall.
_Avoid_: Graduated, mastered, encountered

**Admission**:
The one-time transition of a staged Card into active study under the shared New
Cards per Day allowance.
_Avoid_: Card creation, review, plan inclusion

**Review Event**:
An immutable record of one learner answer to one Card presentation and the
resulting schedule transition.
_Avoid_: Encounter, passive exposure, mutable schedule

**i/i+1 Presentation**:
Learning Material containing either only language the learner already knows
(`i`) or known language plus the one target Card being taught or tested
(`i+1`).
_Avoid_: Multi-target exercise, arbitrary generated sentence

**Subtitle Capture**:
A learner-initiated action that turns one selected vocabulary item in a subtitle
into a Vocabulary Card while preserving ordinary text selection and copying.
_Avoid_: Automatic mining, lookup on selection, sentence Card

**Pending Capture**:
A short-lived, context-bound proposal produced from an explicit subtitle
selection before the learner confirms vocabulary identity and Study writes it.
_Avoid_: Card, lookup result, saved selection

**Subtitle Set**:
An ordered collection of one or more subtitle files that the learner intends to
prepare for as one body of media.
_Avoid_: SRS files, deck, permanent corpus

**Source Revision**:
One immutable, ordered version of the episode cue text and timing in a Subtitle
Set. Editable titles and later analyses do not change it.
_Avoid_: Upload, mutable file list, analysis run

**Cue Evidence**:
A stable, source-bound occurrence of Japanese subtitle text with its episode
and timing. It supports a Card match but never owns learning progress.
_Avoid_: Cue index, sentence Card, encounter credit

**Analysis Run**:
One resumable, versioned analysis of a Source Revision against a particular
provider contract and learner-knowledge snapshot.
_Avoid_: Request, session, Preparation Plan

**Preparation Finding**:
One resolved or explicitly ambiguous grammar construction or vocabulary sense
found during analysis, aggregating every relevant Cue Evidence occurrence and
its relation to the learner's current knowledge.
_Avoid_: Token, subtitle line, Card

**Preparation Gap**:
The comprehension-relevant grammar and vocabulary found in a Subtitle Set that
the learner does not already know and is not already learning.
_Avoid_: Every subtitle token, unknown count, generated deck

**Preparation Plan**:
A learner-specific path that reuses or creates Cards for a Preparation Gap and
stages their study before the corresponding media is watched.
_Avoid_: Episode Plan, Card, subtitle analysis

**Plan Draft**:
An immutable, evidence-backed proposal from Preparation that Study can validate
and atomically commit as a Preparation Plan.
_Avoid_: Generated deck, browser form state, partial Card batch

**Staging Source**:
A Study-owned reason an unseen Card is waiting for admission, such as manual
creation, a Preparation Plan, or Subtitle Capture.
_Avoid_: Second schedule, plan queue, Card owner

**Episode Readiness**:
The fact that every required Preparation Plan Card evidenced in one episode is
known or support-ready; helpful and incidental items do not block it.
_Avoid_: Episode completion, exposure, guaranteed comprehension

**New Cards per Day**:
The learner's single SRS limit for how many previously unseen Cards may enter
study each day, shared by Grammar Cards and Vocabulary Cards from every source.
_Avoid_: Daily new rule limit, Preparation Plan pace, review limit

**V1 Snapshot**:
A bounded, versioned, credential-free capture of one learner's final V1 sync
projection used only for one-way migration into V2.
_Avoid_: Database dump, live sync, account backup

**Migration Reconciliation**:
A complete dry-run accounting of how every V1 learner-progress row will be
mapped, merged, skipped, or quarantined before any V2 write occurs.
_Avoid_: Import log, best-effort conversion, Card list

**Migration Quarantine**:
An auditable refusal to guess when a V1 record lacks the content or progress
semantics needed for a valid V2 Card. It is not a learner Card or Card State.
_Avoid_: Suspended Card, import error, deleted record

**Restore Receipt**:
Evidence that a validated whole-database backup replaced an offline V2 database
and identifies the pre-restore safety copy available for rollback.
_Avoid_: Backup, migration report, sync checkpoint
