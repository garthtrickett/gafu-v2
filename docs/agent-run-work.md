# Work an agent does by hand

Three routes that produce the same durable Cards and readings the pages
produce, run by an agent at a terminal instead. None of them is a
replacement for the app: each ends by writing through the ordinary API, and
nothing downstream can tell which way the material arrived.

The companion document, [agent-assisted
preparation](./agent-assisted-preparation.md), covers the fourth: one
episode of subtitles into Cards. Read its **What the tools get wrong**
section before trusting any of these — every trap in it applies here too.

## Route: a frequency corpus into Cards

Building a vocabulary list from a corpus rather than from a show. A show's
frequency ranking is dominated by that show's topics: of the words needed
for 95% content coverage of one 28-episode series, 81% appeared in three
episodes or fewer. A corpus ranked across many speakers gives words that
transfer.

### Get the corpus

NINJAL publishes the *Corpus of Everyday Japanese Conversation* frequency
tables freely, under CC BY-NC-ND 3.0, at
`https://www2.ninjal.ac.jp/conversation/cejc/cejc-wc.html`. No application,
no fee. Two files matter:

- the **lexeme** table, `2_cejc_frequencylist_suw_token.tsv` — 29,534
  lexemes over 2,419,171 short-unit tokens, with per-genre columns
- the **written-form** table, `5_cejc_frequencylist_suw_shozikei.xlsx` —
  the same, broken down by how each lexeme was actually spelled

The xlsx needs a reader: `python3 -m venv`, then `pip install openpyxl`.
The system Python refuses to install into itself and is right to.

### Rank on the sub-corpus that matches the goal

The overall frequency column pools casual chat with meetings, lessons and
getting-things-done conversations. Rank on **雑談_frequency** instead —
1,659,893 tokens, 68.6% of the corpus, so almost no statistical power is
given up for a list aimed at the register actually wanted.

### The spelling comes from the corpus, not the lexeme

UniDic's 語彙素 is an identifier, not a spelling. Ranking on it puts やはり
and 皆 at the top, when the corpus spells that second lexeme みんな 1,789
times and 皆 115. Take the most-used 書字形 for each lexeme. Doing this also
fixed the exclusions: once the real spelling was compared, both words turned
out to be already known and dropped out, where the first attempt would have
had them relearned under spellings nobody writes.

### Accept only the favoured spelling, and verify it

Tokenise the chosen spelling. Keep it only if it comes back as **one token
of the part of speech the corpus claims**. Do not fall through to a rarer
spelling when the favoured one fails: the 婆 lexeme is written ばあ 454 times
and 婆 seven, and it is 婆 that tokenises, so falling through resurrects a
form nobody uses. 835 of 5,000 were dropped this way, correctly.

Exclude anything tagged 助数詞可能. 円 and 部 are among the most frequent
nouns in any spoken corpus and teach nothing.

### Glosses from the dictionary

The corpus carries lemma, reading and part of speech — no English. Look each
word up (Jisho's `/api/v1/search/words`), politely and resumably: write one
line per word as you go, so a kill costs one lookup rather than the run.
5,000 words at 500ms is about an hour.

Three rules earn their keep, each found by reading the top of the output by
hand rather than by any automatic check:

**The entry must agree on writing *and* reading.** 実 is both じつ (truth)
and み (fruit); matching on the kanji alone takes whichever the dictionary
lists first, and produced a card for み glossed "truth".

**Prefer the dictionary's sense order; only skip a sense of a plainly
different part of speech.** はず was glossed "nock (of a bow)" because its
everyday sense is tagged *Auxiliary* and a part-of-speech filter skipped
past it to the first *Noun*.

**Look up the lexeme too, when the spelling is kana.** Searching じい finds
辞意 before the corpus's 爺, so a card read "intention to resign". Where the
lexeme is written in kanji, search that as well and prefer an entry agreeing
with it.

Also: what the dictionary calls things is not what the analyser calls them.
連体詞 — いろんな, あんな, 大した — is filed here as an adverb and called
"pre-noun adjectival" there. And a する-compound the corpus calls a verb is
tagged "Suru verb"; the corpus decides what part of speech the Card is, the
dictionary only supplies the gloss.

### Import in order

`POST /api/study/cards` accepts `stagingPriority`, and admission runs
`ORDER BY effective_priority DESC`, so setting it from the rank makes the
Cards arrive in frequency order. Reserve a band above the import for Cards
that should jump the queue: a baseline word admitted not known stages at
10,000, a word met while reading at 9,000, a corpus import at
`limit - rank`.

Staging costs nothing until admission, so importing more than will be
studied soon is fine. What it does cost is the review pass below, and every
Card is a row in the bank.

## Auditing Cards that cannot validate

A Card whose own word the analyser will not recognise can never be studied:
every generated sentence is refused, round after round, and the Card stays
due forever. Check for it directly rather than waiting for the failures.

The check is the real one — run `isTargetToken` against the Card's own form
standing alone, with the Card's declared part of speech:

```
for each card:
  analyse the lemma on its own
  if no token satisfies isTargetToken(token, {lemma, reading, partOfSpeech})
    the Card cannot validate
```

Of 5,000 imported words, 88 failed this. The pattern was loanwords and
initialisms the dictionary does not know: tagged 固有名詞 with **no reading
at all**, so the reading comparison can never succeed.

**Repair before suspending.** For a loanword the analyser does not know, the
surface *is* the reading, and that is what the target rule falls back to —
so setting the Card's reading to the kana of its own form makes it
recognisable. 51 of the 88 were repairable this way (スイーツ was carrying
すいーと, ラテ らって, チップス ちっぷ — readings taken from the lexeme when
the analyser gave none for the written form). One was not. The remaining 36
had never been imported.

Suspend what cannot be repaired. There is no Card deletion: Cards carry
review history and identity claims behind `ON DELETE RESTRICT`, so
suspension is the only removal there is, and it is reversible.

## Measuring before deciding

Three distinctions that changed decisions this week, all of them easy to get
backwards.

**Running words, not distinct words.** Coverage is over tokens. 1,847
distinct content words — under 10% of a conversation corpus's vocabulary —
cover 91.8% of what is actually said, because a few thousand words do almost
all the work. Quoting a vocabulary-size percentage where a coverage
percentage is meant overstates the task by an order of magnitude.

**Range, not frequency, when ranking across sources.** Raw frequency within
one source surfaces its topic words. Count how many sources a word appears
in first. `CoverageWord.sources` already carries this.

**Check a ranking against something it was not built on.** Ranking on 雑談
and then measuring against 雑談 flatters itself. Measured against two
registers it was not built on, the same list came in under half a point
lower — which is what made it worth trusting.

The useful translation for a learner is unknown-word density, not coverage:
91.8% is one word in twelve, 95.2% is one in twenty-one.

## Route: writing a tale

A tale in `src/reading/tales.ts` is stored as **plot, in English** — never as
Japanese text. The Japanese is written fresh against the vocabulary of
whoever asks, so two learners read different sentences and the same tale
asked for again later comes back easier.

This is also the rule that keeps the material ours. The tales are
traditional and have no author; retellings and translations of them do have
authors. So: write the beats in your own plain words from the plot, store no
Japanese, and quote no published version. The provider is instructed to do
the same.

### Beats

A beat is **one sentence's worth of story** — what happens next, and at most
one word the tale cannot be told without:

```ts
{ beat: "It was a peach, and it was bigger than her head.",
  word: word("桃", "もも", "noun", "peach") }
```

`word: null` means the sentence may use nothing the learner does not already
have. Those sentences are most of the tale and they are what makes it
readable.

Keep beats **spare and small**. A beat that says three things produces a
cramped summary; a beat that specifies wording fights the generator, which
is the thing that actually knows the reader's vocabulary. One beat is one
generation, checked and retried alone, so fine beats also mean a failure
costs one sentence.

### Length and density

The first pass at 桃太郎 ran to eleven beats. That is a synopsis, and worse,
it put four new words in eleven sentences — one every two and a bit.

Aim for **80–120 beats** and **one new word every 12–20 sentences**. 桃太郎
is 117 beats with seven new words, one every seventeen. Divide the sentence
count by the number of words the reader does not yet have; if the answer is
under ten, the tale is too dense to read for pleasure.

A word the learner has since learned stops being new automatically, so a
tale's density improves on its own as they progress.

### Writing it

Generation is one call per sentence, so a hundred-sentence tale is minutes
and cannot be one request. `POST /api/reading/<tale>` lays out the beats and
returns; each `GET /api/reading/<tale>/progress` writes one sentence and
reports how far it has got; `GET /api/reading/<tale>` returns the finished
reading. What is written is kept, so a tale half told is carried on.

A beat that cannot be written in three rounds is left out and counted rather
than stopping the telling — better a tale missing a sentence than no tale.
The refusal names the sentence and the reason.

### Writing it by hand

The provider is the usual author, not the only one. `PUT
/api/reading/<tale>` takes `{"sentences": [{"index", "japanese",
"english"}]}` — one entry per beat, the whole tale at once — and holds every
sentence to the same `checkBeat` the generator is held to, with the same
target word and the same already-introduced words. One refusal rejects the
lot: the response names the index and the reasons, and nothing is stored.
Furigana is not sent; it is derived from the analyzer, so an author cannot
mis-split a word.

Write against a harness rather than against the server, because a round trip
per attempt is unbearable at a hundred sentences. `/home/gust/tale-check.ts`
takes a file of `{seq, japanese, english}`, runs the real `checkBeat` from
the repo, and derives furigana from kuromoji so a reconstruction failure
cannot be the author's error. Pull the vocabulary it checks against from the
deployment being published to — `GET /api/study/knowledge` — not from a
snapshot taken days ago. 桃太郎 differed by two words in a week, and a tale
that passes locally and is refused on import wastes the whole import.

Work in chunks of twenty-odd beats and get each to a clean pass before
starting the next, then run the merged file once end to end: the
already-introduced words mean a later chunk depends on earlier ones, and a
whole-tale pass is the only thing that proves the tale holds together.

### What goes wrong

**A beat that needs a word the tale did not declare.** The commonest
failure, and the refusal says which word. Either declare it on that beat or
reword the beat to avoid it.

**Counting.** 笠地蔵 turns on six statues and five hats. Generators are
unreliable about numbers; split such a beat so each sentence carries one
fact.

**A tale word the learner already has.** Not a failure — the beat quietly
becomes an ordinary sentence. Check the tale list, which shows only the
words still new.

**Tokenisation, when writing by hand.** Four of 桃太郎's refusals were the
tokeniser rather than the vocabulary. 長い間男の子 splits as 間男; a comma
after 長い間 fixes it. 約束し and 退治する come out as single unknown tokens;
約束をしました and 鬼の退治をする do not. The refusal names a "word" that is
not one — that is the tell.

**A word the tale needs and cannot paraphrase.** 桃太郎 without a named
monkey is not 桃太郎, and 猿 cannot be said with the words a learner of
1,500 has. Declare it on its beat. A pheasant's 雉 is the opposite case:
nothing is lost by calling it 鳥 and describing it.

## Conventions

`GAFU_ACCESS_PASSWORD` signs in, from an environment file at `~/.gafu-env`,
sourced before running and never written into anything the scripts produce.
Mutating routes need `X-Gafu-Request: gafu-v2`.

Anything over about ten minutes belongs in `work run "<what>" -- systemd-run
--user --scope --quiet <cmd>`, and should write output incrementally so a
kill costs one unit of work rather than all of it. The hour-long dictionary
pass and the corpus audits were all run this way.

Do not read a gate's result through a pipe. `bun run check 2>&1 | tail -1`
showed a clean line while the type checker was failing underneath, twice.
Check the exit code.
