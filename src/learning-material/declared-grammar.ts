import type { DetectedGrammar, GrammarDetector } from "./contracts.ts";

type GrammarPattern = Readonly<{
  canonicalForm: string;
  expression: RegExp;
}>;

const patterns: readonly GrammarPattern[] = [
  { canonicalForm: "〜ている", expression: /[てで]いる/g },
  { canonicalForm: "〜たことがある", expression: /たことがある/g },
  { canonicalForm: "〜なければならない", expression: /なければならない/g },
  { canonicalForm: "〜てもいい", expression: /てもいい/g },
  { canonicalForm: "〜てはいけない", expression: /[てで]はいけない/g },
  { canonicalForm: "〜そうだ（様態）", expression: /そうだ/g },
  { canonicalForm: "〜かもしれない", expression: /かもしれない/g },
  { canonicalForm: "〜ので", expression: /ので/g },
  { canonicalForm: "〜のに", expression: /のに/g },
  { canonicalForm: "〜ながら", expression: /ながら/g },
  {
    canonicalForm: "〜たり〜たりする",
    expression: /[ただ]り[^。]*[ただ]りする/g,
  },
  { canonicalForm: "〜ようになる", expression: /ようにな(?:る|っ)/g },
  { canonicalForm: "〜ことにする", expression: /ことにし(?:た|て|ます|よう)/g },
  { canonicalForm: "〜つもりだ", expression: /つもりだ/g },
  { canonicalForm: "〜たばかりだ", expression: /たばかりだ/g },
  { canonicalForm: "〜てしまう（縮約）", expression: /(?:ちゃ|じゃ)(?:う|っ)/g },
  { canonicalForm: "可能形", expression: /(?:[えけげせてねべめれ]る|できる)/g },
  { canonicalForm: "受身形", expression: /(?:れ|られ)(?:る|た|て)/g },
  { canonicalForm: "使役形", expression: /(?:せ|させ)(?:る|た|て)/g },
  { canonicalForm: "〜ほど〜ない", expression: /ほど[^。]*ない/g },
  { canonicalForm: "〜前に", expression: /前に/g },
  { canonicalForm: "〜ても", expression: /ても/g },
  // Batch 1: V1 inventory #1-25. Canonical forms are verbatim V1 formalNames so
  // migrated cards match exactly. New entries append; never reorder or rename.
  { canonicalForm: "だ", expression: /だ/g },
  { canonicalForm: "は", expression: /は/g },
  { canonicalForm: "も", expression: /も/g },
  { canonicalForm: "に", expression: /に/g },
  { canonicalForm: "で", expression: /で/g },
  { canonicalForm: "を", expression: /を/g },
  { canonicalForm: "が", expression: /が/g },
  { canonicalForm: "から", expression: /から/g },
  { canonicalForm: "まで", expression: /まで/g },
  { canonicalForm: "と", expression: /と/g },
  { canonicalForm: "よ", expression: /よ/g },
  { canonicalForm: "ね", expression: /ね/g },
  { canonicalForm: "～んです", expression: /なんです|のです|んです|んだ|のだ/g },
  { canonicalForm: "の", expression: /の/g },
  { canonicalForm: "けど", expression: /けれども|けれど|だけど|だが|けど/g },
  { canonicalForm: "とか", expression: /とか/g },
  { canonicalForm: "とく", expression: /ておく|でおく|とく|どく/g },
  { canonicalForm: "なきゃ", expression: /なきゃ|なくちゃ|なければ/g },
  { canonicalForm: "みたい", expression: /みたい/g },
  { canonicalForm: "これ", expression: /これ/g },
  { canonicalForm: "それ", expression: /それ/g },
  { canonicalForm: "あれ", expression: /あれ/g },
  { canonicalForm: "か", expression: /か/g },
  { canonicalForm: "ここ", expression: /ここ/g },
  { canonicalForm: "そこ", expression: /そこ/g },
  // Batch 2: V1 inventory #26-50. Same conventions: verbatim V1 formalNames,
  // append-only. Note the deliberate couplings: 〜ない (る/う) share one
  // surface, as do の / の ( nominalizer ); keep-all detection requires the
  // learner to know every coupled identity, matching the 受身形/可能形 precedent.
  { canonicalForm: "あそこ", expression: /あそこ/g },
  { canonicalForm: "〜くない", expression: /くない/g },
  { canonicalForm: "〜じゃない", expression: /じゃない/g },
  { canonicalForm: "〜ない (る-Verb Negative)", expression: /ない/g },
  { canonicalForm: "〜ない (う-Verb Negative)", expression: /ない/g },
  { canonicalForm: "〜ます", expression: /ます/g },
  { canonicalForm: "でしょう", expression: /でしょう/g },
  { canonicalForm: "だろう", expression: /だろう/g },
  { canonicalForm: "がある", expression: /がある/g },
  { canonicalForm: "がいる", expression: /がいる/g },
  { canonicalForm: "この", expression: /この/g },
  { canonicalForm: "その", expression: /その/g },
  { canonicalForm: "あの", expression: /あの/g },
  { canonicalForm: "〜かった", expression: /かった/g },
  { canonicalForm: "の ( nominalizer )", expression: /の/g },
  { canonicalForm: "する", expression: /する/g },
  { canonicalForm: "くる", expression: /くる/g },
  {
    // Kana i/e-row stems match okurigana inflection (食べた); the kanji
    // alternates cover common ichidan stems with no kana inflection tail
    // (見た). Regex-on-surface cannot read kanji stems in general; that
    // ceiling is recorded in the batch evidence note.
    canonicalForm: "〜た (る)",
    expression: /(?:[いきしちにひみりぎじびぴえけせてねへべぺめれ]|見|寝|起|着|居)た/g,
  },
  {
    canonicalForm: "〜た (う)",
    expression:
      /(?:っ|ん)[ただ]|いだ|[いきしちにひみりぎじびぴえけせてねへべぺめれ]た/g,
  },
  { canonicalForm: "好き", expression: /好き|すき/g },
  { canonicalForm: "きらい", expression: /嫌い|きらい/g },
  { canonicalForm: "のがすき", expression: /のがすき|のが好き/g },
  { canonicalForm: "ので / から", expression: /ので|から/g },
  { canonicalForm: "〜なかった", expression: /なかった/g },
  { canonicalForm: "〜て", expression: /(?:て|で)/g },
  // Batch 3: V1 inventory #51-75 (68 〜てもいい and 70 〜たり〜たりする already
  // declared above). Coupled surfaces: 〜ている (進行/状態) share one regex,
  // and じゃない duplicates Batch 2's 〜じゃない; keep-all requires every
  // coupled identity to be known.
  { canonicalForm: "〜ている (進行)", expression: /[てで]いる/g },
  { canonicalForm: "〜にいく", expression: /にいく|にいき|にいっ/g },
  { canonicalForm: "だれ", expression: /だれ|誰/g },
  { canonicalForm: "なんで / どうして", expression: /なんで|どうして/g },
  { canonicalForm: "じゃない", expression: /じゃない/g },
  { canonicalForm: "〜くなかった", expression: /くなかった/g },
  { canonicalForm: "って", expression: /って/g },
  {
    canonicalForm: "Verb + Noun",
    expression: /(?:る|む|ぶ|ぬ|す|く|ぐ|う|つ|た|ない)(?:人|物|事|もの|こと)/g,
  },
  { canonicalForm: "の (省略)", expression: /の/g },
  { canonicalForm: "な", expression: /な/g },
  { canonicalForm: "だけ", expression: /だけ/g },
  { canonicalForm: "どこ", expression: /どこ/g },
  { canonicalForm: "どれ", expression: /どれ/g },
  { canonicalForm: "〜ている (状態)", expression: /[てで]いる/g },
  { canonicalForm: "てから", expression: /てから|でから/g },
  { canonicalForm: "もう / まだ", expression: /もう|まだ/g },
  { canonicalForm: "まだ〜てない", expression: /まだ[^。]*?[てで]いない/g },
  { canonicalForm: "〜たい", expression: /たい/g },
  { canonicalForm: "けっこう", expression: /けっこう|結構/g },
  { canonicalForm: "たくさん", expression: /たくさん|沢山/g },
  { canonicalForm: "くらい / ぐらい", expression: /くらい|ぐらい/g },
  { canonicalForm: "すぎる", expression: /すぎる|過ぎる/g },
  { canonicalForm: "にする", expression: /にする/g },
  // Batch 4: V1 inventory #76-100 (84 〜たことがある and 88 つもりだ already
  // declared above). とき stays kana-only: kanji 時 inside 時間 or clock
  // times like 3時 is a different construction and must not force とき
  // knowledge. Adjective + て / Noun + で is enumerative (くて/気で/れいで);
  // unseen predicative-conjunction surfaces are a recorded ceiling.
  { canonicalForm: "〜になる・〜くなる", expression: /になる|くなる/g },
  { canonicalForm: "〜のほうが", expression: /のほうが/g },
  { canonicalForm: "なにか・なにも", expression: /なにか|なにも|何か|何も/g },
  {
    canonicalForm: "誰か・どこか・誰も・どこも",
    expression: /誰か|誰も|どこか|どこも|だれか|だれも|どこも/g,
  },
  { canonicalForm: "〜ましょう / 〜ましょうか", expression: /ましょう/g },
  { canonicalForm: "〜ませんか", expression: /ませんか/g },
  { canonicalForm: "〜ないでください", expression: /ないでください/g },
  {
    canonicalForm: "〜たほうがいい / 〜ないほうがいい",
    expression: /たほうがいい|ないほうがいい/g,
  },
  { canonicalForm: "Adjective + て / Noun + で", expression: /くて|気で|れいで/g },
  {
    canonicalForm: "のがへた / のがじょうず",
    expression: /のがへた|のが下手|のがじょうず|のが上手/g,
  },
  {
    canonicalForm: "あげる / くれる / もらう",
    expression: /あげる|くれる|もらう|上げる|呉れる|貰う/g,
  },
  { canonicalForm: "とき", expression: /とき/g },
  { canonicalForm: "あとで", expression: /あとで|後で/g },
  { canonicalForm: "までに", expression: /までに/g },
  { canonicalForm: "ごろ", expression: /ごろ|頃/g },
  { canonicalForm: "〜ていた", expression: /ていた|でいた/g },
  { canonicalForm: "るところだ", expression: /るところ|るとこ/g },
  {
    canonicalForm: "〜ていく / 〜てくる",
    expression: /ていく|てくる|でいく|でくる/g,
  },
  {
    canonicalForm: "〜やすい",
    expression:
      /(?:[いきしちにひみりぎじびぴえけせてねへべぺめれ]|見|寝|起|着|居)やすい/g,
  },
  {
    canonicalForm: "〜にくい",
    expression:
      /(?:[いきしちにひみりぎじびぴえけせてねへべぺめれ]|見|寝|起|着|居)にくい/g,
  },
  {
    canonicalForm: "〜づらい",
    expression:
      /(?:[いきしちにひみりぎじびぴえけせてねへべぺめれ]|見|寝|起|着|居)づらい/g,
  },
  { canonicalForm: "〜はじめる", expression: /はじめる|始める/g },
  { canonicalForm: "〜おわる", expression: /おわる|終わる/g },
  // Batch 5: V1 inventory #101-125 (103 のに and 121 かもしれない already
  // declared above). がる uses a stem class so bare verbs like 上がる do not
  // fire it; Verb[よう] intentionally couples with every よう-compound.
  { canonicalForm: "〜なおす", expression: /なおす|直す/g },
  { canonicalForm: "ないで / なくて", expression: /ないで|なくて/g },
  // れる・られる mirrors the 可能形 surface class: godan potential ends in
  // e-row + る (読める) while ichidan forms end in れる/られる.
  { canonicalForm: "でも", expression: /でも/g },
  {
    canonicalForm: "れる・られる",
    expression: /(?:[えけげせてねべめれ]る|れる|られる)/g,
  },
  { canonicalForm: "ということ", expression: /ということ|という事/g },
  { canonicalForm: "だけで", expression: /だけで/g },
  { canonicalForm: "なるべく", expression: /なるべく/g },
  { canonicalForm: "〜ら", expression: /ら/g },
  { canonicalForm: "だんだん / どんどん", expression: /だんだん|どんどん/g },
  { canonicalForm: "とおもう", expression: /とおもう|と思う/g },
  { canonicalForm: "こと", expression: /こと|事/g },
  { canonicalForm: "そう (伝聞・様態)", expression: /そうだ|そうです/g },
  { canonicalForm: "とか～とか", expression: /とか[^。]*とか/g },
  { canonicalForm: "そういう", expression: /そういう/g },
  {
    canonicalForm: "Verb[よう]",
    expression: /(?:[おこそとのほもよろぼぽごぞど]う|よう)/g,
  },
  { canonicalForm: "かな", expression: /かな/g },
  { canonicalForm: "ば / なら", expression: /ば|なら/g },
  // がる attaches to adjective stems that are often a bare kanji on the
  // surface (怖がる); the listed kanji are fixture-driven and the open tail
  // is a recorded ceiling for analyzer-backed detection.
  {
    canonicalForm: "がる / たがる",
    expression:
      /(?:[いきしちにひみりぎじびぴえけせてねへべぺめれたむわん]|寒|怖|痛|痒|恥|欲|念|寂)がる/g,
  },
  { canonicalForm: "がする", expression: /がする/g },
  { canonicalForm: "みたいに・みたいな", expression: /みたいに|みたいな/g },
  { canonicalForm: "そうに・そうな", expression: /そうに|そうな/g },
  // 〜ようと思う accepts godan volitional endings (走ろうと思う) as well as
  // よう, mirroring the Verb[よう] stem class.
  {
    canonicalForm: "〜ようと思う",
    expression:
      /(?:[おこそとのほもよろぼぽごぞど]う|よう)とおもう|(?:[おこそとのほもよろぼぽごぞど]う|よう)と思う/g,
  },
  { canonicalForm: "〜にする / 〜くする", expression: /にする|くする/g },
  // Batch 6: V1 inventory #126-150 (127 ようになる already declared above).
  // Verb［せる・させる］ shares its surface with 使役形; both fire together.
  { canonicalForm: "といい", expression: /といい/g },
  { canonicalForm: "じゃないか", expression: /じゃないか/g },
  { canonicalForm: "らしい", expression: /らしい/g },
  { canonicalForm: "てほしい", expression: /てほしい|でほしい/g },
  {
    canonicalForm: "聞こえる / 見える",
    expression: /聞こえる|見える|きこえる|みえる/g,
  },
  { canonicalForm: "～代", expression: /代/g },
  { canonicalForm: "かかる / する (コスト)", expression: /かかる/g },
  {
    canonicalForm: "Number + も",
    expression:
      /[0-9０-９一二三四五六七八九十百千万]+(?:つ|人|回|個|冊|匹|台|時|分|円|歳|才|年|か月|月|日|週|時間)?も/g,
  },
  { canonicalForm: "ほとんど", expression: /ほとんど|殆ど/g },
  {
    canonicalForm: "そんな・こんな・あんな・どんな",
    expression: /そんな|こんな|あんな|どんな/g,
  },
  { canonicalForm: "以上 / 以外", expression: /以上|以外/g },
  { canonicalForm: "ずっと", expression: /ずっと/g },
  { canonicalForm: "だいたい", expression: /だいたい|大体/g },
  {
    canonicalForm: "なん + counter + か",
    expression:
      /(?:なん|何)(?:つ|人|回|個|冊|匹|台|時|分|円|歳|才|年|か月|月|日|週|時間|度|番|階|泊)?か/g,
  },
  { canonicalForm: "真(っ)", expression: /真っ|まっ(?=[しろくろあかあおくら])/g },
  {
    canonicalForm: "Number + しか〜ない",
    expression:
      /[0-9０-９一二三四五六七八九十百千万]+(?:つ|人|回|個|冊|匹|台|時|分|円|歳|才|年|か月|月|日|週|時間)?しか[^。]*?ない/g,
  },
  {
    canonicalForm: "すこしも～ない",
    expression: /すこしも[^。]*?ない|少しも[^。]*?ない/g,
  },
  { canonicalForm: "ばあいは", expression: /ばあいは|場合は/g },
  { canonicalForm: "てよかった", expression: /てよかった|でよかった/g },
  { canonicalForm: "Verb［せる・させる］", expression: /(?:せ|させ)(?:る|た|て)/g },
  { canonicalForm: "〜ても・〜でも", expression: /ても|でも/g },
  {
    canonicalForm: "てしまう / ちゃう",
    expression: /てしまう|でしまう|ちゃう|じゃう/g,
  },
  { canonicalForm: "させられる", expression: /させられる/g },
  { canonicalForm: "てある", expression: /てある|である/g },
  // Batch 7: V1 inventory #151-175 (170 ながら already declared above).
  // と (条件) is verb-plain + と; comitative と after nouns that end in a
  // verb-class kana (私と) is an accepted over-fire, recorded below. し uses
  // a negative lookahead so verb inflections (します/しない/しかし/少し)
  // do not fire it. かい is end-anchored so 社会 never fires it.
  { canonicalForm: "ているあいだに", expression: /[てで]いるあいだに|[てで]いる間に/g },
  { canonicalForm: "なくてもいい", expression: /なくてもいい/g },
  { canonicalForm: "てみる", expression: /てみる|でみる/g },
  {
    canonicalForm: "〜てあげる / 〜てくれる / 〜てもらう",
    expression: /てあげる|であげる|てくれる|でくれる|てもらう|でもらう/g,
  },
  {
    canonicalForm: "〜てくれてありがとう",
    expression: /てくれてありがとう|でくれてありがとう/g,
  },
  {
    canonicalForm: "〜てくれない / 〜てもらえない",
    expression: /てくれない|でくれない|てもらえない|でもらえない/g,
  },
  {
    canonicalForm: "たら",
    expression:
      /(?:[いきしちにひみりぎじびぴえけせてねへべぺめれたっん]|見|寝|起|着|居)たら|んだら/g,
  },
  { canonicalForm: "ほかに", expression: /ほかに|他に/g },
  { canonicalForm: "そんなに", expression: /そんなに/g },
  {
    canonicalForm: "れる・られる (可能)",
    expression: /(?:[えけげせてねべめれ]る|れる|られる)/g,
  },
  { canonicalForm: "んだけど / んですが", expression: /んだけど|んですが/g },
  {
    canonicalForm: "はずだ / はずがない",
    expression: /はずだ|はずです|はずがない/g,
  },
  { canonicalForm: "かどうか", expression: /かどうか/g },
  {
    canonicalForm: "と (条件)",
    expression:
      /(?:[うくすつぬぶむぐずづぷる]|ます|た|ない|だ|だろう|でしょう|よう|まい)と/g,
  },
  { canonicalForm: "ないと", expression: /ないと/g },
  { canonicalForm: "だけでなく", expression: /だけでなく/g },
  { canonicalForm: "かい", expression: /かい(?=[。？?！!]|$)/g },
  { canonicalForm: "もし", expression: /もし|若し/g },
  { canonicalForm: "し", expression: /し(?![まなかきくけこらりるれろっんず])/g },
  { canonicalForm: "ようにする", expression: /ようにする/g },
  { canonicalForm: "〜つづける", expression: /つづける|続ける/g },
  {
    canonicalForm: "ようにいう",
    expression: /ように(?:言う|言わ|言っ|言った|いう|いわ|いっ)/g,
  },
  {
    canonicalForm: "よていだ",
    expression: /よていだ|予定だ|よていです|予定です/g,
  },
  { canonicalForm: "〜たばかり", expression: /たばかり/g },
  // Batch 8: V1 inventory #176-200. 命令形 is end-anchored so nouns like 後ろ
  // never fire it; かい likewise so 社会 never fires it. し uses a negative
  // lookahead so verb inflections do not fire it. と (条件) after nouns that
  // end in a verb-class kana (私と) and 風 inside 台風 are accepted
  // over-fires. させてもらう only matches ichidan/suru/kuru causatives;
  // godan せ+てもらう (休ませてもらう) is a recorded ceiling.
  // 命令形 splits by collision risk: げぜでえ rarely end sentences
  // non-imperatively, so they allow 。; other e-row endings require a command
  // continuation (よ/ぞ/ぜ/、) because ね。/て。/れ。/め。 end ordinary
  // sentences constantly and れ+な would fire inside every られない form.
  // 来い is the kanji-stem exception. ろ。 can still false-fire on nouns
  // like 後ろ; that friction is recorded below.
  {
    canonicalForm: "命令形 (動詞)",
    expression:
      /(?:しろ|しよ|こい|来い)(?=[。？?！!、]|$)|[げぜでえ](?=[。？?！!、よぞぜ]|$)|[えけせてねへべぺめれ](?=[、よぞぜ])|ろ(?=[。？?！!、]|$)/g,
  },
  { canonicalForm: "ように (目的)", expression: /ように/g },
  { canonicalForm: "かしら", expression: /かしら/g },
  { canonicalForm: "って感じ", expression: /って感じ/g },
  { canonicalForm: "風", expression: /風/g },
  { canonicalForm: "にきがつく", expression: /に気がつく|に気が付く|にきがつく/g },
  { canonicalForm: "それに", expression: /それに/g },
  { canonicalForm: "それで", expression: /それで/g },
  {
    canonicalForm: "Question-phrase + か",
    expression:
      /(?:だれ|なに|なん|どこ|どれ|どう|いつ|なぜ|なんで|どうして|いくら|いくつ|どの|どんな)か/g,
  },
  { canonicalForm: "それでも", expression: /それでも/g },
  { canonicalForm: "たらどう", expression: /(?:た|だ)らどう/g },
  { canonicalForm: "といわれている", expression: /といわれている|と言われている/g },
  { canonicalForm: "ばよかった", expression: /ばよかった/g },
  { canonicalForm: "ばいい", expression: /ばいい/g },
  {
    canonicalForm: "中",
    expression: /の中|中(?=[でにはもだです。、]|$)/g,
  },
  {
    canonicalForm: "うちに / ないうちに",
    expression: /うちに|ないうちに|内に|ない内に/g,
  },
  {
    canonicalForm: "べき / べきではない",
    expression: /べきだ|べきです|べきではない|べきでない|べき/g,
  },
  { canonicalForm: "なかなか", expression: /なかなか/g },
  { canonicalForm: "なかなか〜ない", expression: /なかなか[^。]*?ない/g },
  { canonicalForm: "によって", expression: /によって/g },
  { canonicalForm: "全く〜ない", expression: /全く[^。]*?ない|まったく[^。]*?ない/g },
  { canonicalForm: "させてもらう", expression: /させてもらう/g },
  {
    canonicalForm: "Particle + の",
    expression:
      /(?:私|僕|俺|君|彼|彼女|あなた|これ|それ|あれ|ここ|そこ|あそこ|どこ|だれ|なに|なん|何|みんな)の/g,
  },
  { canonicalForm: "ところが / ところで", expression: /ところが|ところで/g },
  { canonicalForm: "ほど / ほど〜ない", expression: /ほど/g },
  // Batch 9: V1 inventory #201-225. 〜合う stays kana-stem-only: kanji 合い
  // inside 試合 is a different word and must not force 合う knowledge. 的 is
  // bare despite 目的 coupling; that friction is recorded below.
  { canonicalForm: "ば〜ほど", expression: /ば[^。]*?ほど/g },
  { canonicalForm: "という / というのは", expression: /という|というのは/g },
  { canonicalForm: "的", expression: /的/g },
  { canonicalForm: "もの / もん", expression: /もの|もん/g },
  { canonicalForm: "ものだ", expression: /ものだ|もんだ|ものです|もんです/g },
  { canonicalForm: "おかげで", expression: /おかげで/g },
  { canonicalForm: "こそ / からこそ", expression: /こそ/g },
  { canonicalForm: "ばかり", expression: /ばかり/g },
  { canonicalForm: "ばかりに", expression: /ばかりに/g },
  { canonicalForm: "ことがある (頻度)", expression: /ことがある/g },
  // ことにする / ことになる inflects at its endpoint (した/なった/しない);
  // the stem alternation covers the common forms.
  {
    canonicalForm: "ことにする / ことになる",
    expression:
      /ことにする|ことになる|ことにした|ことになった|ことにしない|ことにならない|ことにしろ|ことになれ/g,
  },
  { canonicalForm: "ことはない", expression: /ことはない/g },
  { canonicalForm: "～と言っても", expression: /と言っても|といっても/g },
  { canonicalForm: "といえば", expression: /といえば|と言えば/g },
  {
    canonicalForm: "〜合う",
    expression: /[いきしちにひみりぎじびぴえけせてねへべぺめれ]あう/g,
  },
  { canonicalForm: "について", expression: /について/g },
  { canonicalForm: "ちゃんと", expression: /ちゃんと/g },
  { canonicalForm: "に比べて", expression: /に比べて|にくらべて/g },
  {
    canonicalForm: "どんなに〜ても / いくら〜でも",
    expression: /どんなに[^。]*?ても|いくら[^。]*?でも/g,
  },
  { canonicalForm: "かなり", expression: /かなり/g },
  { canonicalForm: "あまりに", expression: /あまりに/g },
  {
    canonicalForm: "わけだ / わけではない",
    expression: /わけだ|わけではない|わけです|わけではありません/g,
  },
  { canonicalForm: "ところだった", expression: /ところだった/g },
  { canonicalForm: "だって / んだって", expression: /だって|んだって/g },
  { canonicalForm: "に対して", expression: /に対して|にたいして/g },
  // Batch 10: V1 inventory #226-250. さ is end-anchored (plus さあ) so さん
  // never fires it; 朝 as a fragment remains an accepted over-fire.
  { canonicalForm: "さ (フィラー・間投詞)", expression: /さあ|さ(?=[。？?！!、]|$)/g },
  { canonicalForm: "それぞれ", expression: /それぞれ|各々/g },
  { canonicalForm: "まま", expression: /まま/g },
  { canonicalForm: "しかない", expression: /しかない/g },
  { canonicalForm: "～ても～なくても", expression: /(?:て|で)も[^。]*?なくても/g },
  { canonicalForm: "んじゃない", expression: /んじゃない/g },
  { canonicalForm: "わけがない", expression: /わけがない/g },
  { canonicalForm: "としたら / とすると", expression: /としたら|とすると/g },
  { canonicalForm: "として", expression: /として/g },
  { canonicalForm: "にしては", expression: /にしては/g },
  { canonicalForm: "にしても", expression: /にしても/g },
  { canonicalForm: "にとって", expression: /にとって/g },
  { canonicalForm: "というより", expression: /というより/g },
  { canonicalForm: "はもちろん", expression: /はもちろん/g },
  {
    canonicalForm: "て初めて",
    expression: /て初めて|ではじめて|てはじめて|で初めて/g,
  },
  { canonicalForm: "さえ / さえ〜ば", expression: /さえ/g },
  { canonicalForm: "たものだ", expression: /たものだ|だものだ/g },
  { canonicalForm: "さて", expression: /さて/g },
  { canonicalForm: "むしろ", expression: /むしろ/g },
  { canonicalForm: "つまり", expression: /つまり/g },
  { canonicalForm: "かえって", expression: /かえって/g },
  { canonicalForm: "〜気がする", expression: /気がする/g },
  { canonicalForm: "とても〜ない", expression: /とても[^。]*?ない/g },
  { canonicalForm: "別に〜ない", expression: /別に[^。]*?ない|べつに[^。]*?ない/g },
  { canonicalForm: "じゃなくて", expression: /じゃなくて/g },
  // Batch 11: V1 inventory #251-275. なし/あり anchor on a preceding kanji,
  // katakana, punctuation, or start so 話 never fires なし. 切る-compounds
  // enumerate verb stems so できる never fires 切る. かけ/たて require an
  // i-row stem so 出かける/建てる never fire them. 旅に remains an accepted
  // たびに over-fire.
  { canonicalForm: "〜ようとしない", expression: /ようとしない/g },
  { canonicalForm: "もしかしたら", expression: /もしかしたら/g },
  { canonicalForm: "〜かというと", expression: /かというと/g },
  { canonicalForm: "〜ずつ", expression: /ずつ/g },
  { canonicalForm: "だらけ", expression: /だらけ/g },
  {
    canonicalForm: "〜み",
    expression:
      /(?:楽し|悲し|嬉し|痛|痒|赤|青|白|黒|深|高|安|近|遠|強|弱|甘|辛|苦|喜|驚)み/g,
  },
  { canonicalForm: "〜と違って", expression: /と違って/g },
  { canonicalForm: "に違いない", expression: /に違いない/g },
  { canonicalForm: "に限る / とは限らない", expression: /に限る|とは限らない/g },
  { canonicalForm: "めったに〜ない", expression: /めったに[^。]*?ない/g },
  { canonicalForm: "割に", expression: /割に|わりに/g },
  {
    canonicalForm: "Verb[volitional]とする",
    expression: /(?:[おこそとのほもよろぼぽごぞど]う|よう)とする/g,
  },
  { canonicalForm: "そうもない", expression: /そうもない/g },
  { canonicalForm: "ないことはない", expression: /ないことはない/g },
  { canonicalForm: "なんか・なんて", expression: /なんか|なんて/g },
  { canonicalForm: "ついでに", expression: /ついでに/g },
  { canonicalForm: "たとたんに", expression: /たとたんに/g },
  { canonicalForm: "おきに / たびに", expression: /おきに|たびに/g },
  {
    canonicalForm: "なし / あり",
    expression:
      /(?:[\u4e00-\u9faf\u30a0-\u30ff、。？?！!「『（]|^)なし|(?:[\u4e00-\u9faf\u30a0-\u30ff、。？?！!「『（]|^)あり/g,
  },
  { canonicalForm: "考えられない", expression: /考えられない/g },
  { canonicalForm: "〜向き / 〜向け", expression: /向き|向け/g },
  {
    canonicalForm: "〜切る / 〜きれない",
    expression:
      /(?:食|飲|読|書|走|使|切|張|締|尽|困|疲|冷|乾|晴|聞|言|買|借|終|倒)き(?:る|れる|れない)|切る|切れる|きれない/g,
  },
  { canonicalForm: "〜きり", expression: /っきり|切り|限り/g },
  {
    canonicalForm: "〜かけ",
    expression: /[いきしちにひみりぎじびぴえけせてねへべぺめれ]かけ|掛け/g,
  },
  {
    canonicalForm: "〜たて",
    expression: /[いきしちにひみりぎじびぴえけせてねへべぺめれ]たて/g,
  },
  // Batch 12: V1 inventory #277-296, completing verbatim V1 coverage.
  // つい anchors on start or particles/auxiliaries so きつい never fires it.
  // 込む is usually written with the kanji; both surfaces are covered.
  { canonicalForm: "〜込む", expression: /こむ|込む/g },
  { canonicalForm: "ふりをする", expression: /ふりをする|フリをする/g },
  { canonicalForm: "できれば (できたら)", expression: /できれば|できたら/g },
  { canonicalForm: "でよければ", expression: /でよければ/g },
  { canonicalForm: "とおり", expression: /とおり|通り/g },
  { canonicalForm: "どうしても", expression: /どうしても/g },
  { canonicalForm: "同士", expression: /同士|どうし/g },
  { canonicalForm: "まさか", expression: /まさか/g },
  {
    canonicalForm: "つい",
    expression:
      /(?:^|[、。はがもにでとからまでよりのでてっなたないますですようまい])つい/g,
  },
  { canonicalForm: "せいで", expression: /せいで/g },
  { canonicalForm: "くせに", expression: /くせに/g },
  { canonicalForm: "〜がち / 〜ぎみ", expression: /がち|ぎみ/g },
  { canonicalForm: "〜っぽい", expression: /っぽい/g },
  { canonicalForm: "〜っぱなし", expression: /っぱなし/g },
  { canonicalForm: "わざわざ", expression: /わざわざ/g },
  { canonicalForm: "一体", expression: /一体|いったい/g },
  { canonicalForm: "折角", expression: /折角|せっかく/g },
  { canonicalForm: "っけ", expression: /っけ/g },
  { canonicalForm: "代わりに", expression: /代わりに|かわりに/g },
  { canonicalForm: "どころか", expression: /どころか/g },
  // Batch 11b + tilde-alignment: わけにはいかない (V1 #251) was skipped in
  // Batch 11, and five V1 names lack the 〜 prefix of their original-22
  // counterparts. Verbatim entries couple with the originals under keep-all,
  // exactly like の / の ( nominalizer ) / の (省略).
  { canonicalForm: "わけにはいかない", expression: /わけにはいかない/g },
  { canonicalForm: "つもりだ", expression: /つもりだ/g },
  { canonicalForm: "のに", expression: /のに/g },
  { canonicalForm: "かもしれない", expression: /かもしれない/g },
  { canonicalForm: "ようになる", expression: /ようにな(?:る|っ)/g },
  { canonicalForm: "ながら", expression: /ながら/g },
];

export const declaredGrammarForms = patterns.map((pattern) => pattern.canonicalForm);

/**
 * The declared forms are written for a reader, not for comparison: some carry
 * the placeholder tilde, some a parenthetical sense, some list alternates
 * separated by a slash, and the tilde and brackets appear at both widths.
 * `〜てしまう（縮約）` and `てしまう / ちゃう` are both declared, so a Card naming
 * the plain `〜てしまう` names a construction the generator knows and a literal
 * comparison still refuses it -- as it refused four Cards the V1 migration
 * created, which differ from their declared forms only in character width.
 */
const comparable = (form: string): readonly string[] =>
  form
    .normalize("NFKC")
    .split("/")
    .map((part) =>
      part
        .replace(/[（(][^）)]*[）)]/gu, "")
        // Tildes are placeholders wherever they appear, and are written three
        // ways: the V1 Cards carry `~ても~なくても` where the declared form has
        // `～ても～なくても`, which is the same construction.
        .replace(/[~\uff5e\u301c]/gu, "")
        .trim(),
    )
    .filter((part) => part !== "");

const declaredTargets = new Set(declaredGrammarForms.flatMap(comparable));

/**
 * Whether material can be generated for a Grammar Card naming this form. The
 * Card route and the material validator both ask here, so a Card that is
 * accepted can always be taught.
 */
export const supportsGrammarTarget = (canonicalForm: string): boolean =>
  comparable(canonicalForm).some((part) => declaredTargets.has(part));

export const declaredGrammarDetector: GrammarDetector = {
  detect: (normalizedJapanese): readonly DetectedGrammar[] =>
    patterns.flatMap((pattern) =>
      Array.from(normalizedJapanese.matchAll(pattern.expression), (match) => ({
        canonicalForm: pattern.canonicalForm,
        spans: [
          {
            start: match.index,
            end: match.index + match[0].length,
            unit: "utf16-code-unit" as const,
            normalization: "nfkc-v1" as const,
          },
        ],
      })),
    ),
};
