"""rich_content.py — one structured document, rendered per destination.

The ask was "content should be full rich content not just markdown ... with
emoticon, or bold italic etc etc full rich ui". The obvious reading of that is
"tell the model to emit markdown", and this product ALREADY does exactly that.
That is the defect, not the fix.

── WHAT MARKDOWN DOES ON THE WIRE TODAY ─────────────────────────────────────

`routers/hub.py` QUICK_SKILL_PROMPTS["social_post"]["system"] instructs the
model, verbatim: "Use markdown formatting: **bold** for emphasis, headers for
sections". Whatever comes back is stored on `hub_content_items.body`.
`services/social_publisher.publish_content` then reads that column —

    text = item["body"] or item["title"] or ""

— and hands it to whichever publisher the queue row names. `publish_to_linkedin`
puts it into `specificContent."com.linkedin.ugc.ShareContent".shareCommentary
.text`, which is a PLAIN TEXT field: LinkedIn's composer has never rendered
markdown, in the feed or through the API. So the emphasis that prompt asked for
reaches the customer's company page as a literal pair of asterisks around the
word. Instagram captions do the same. WhatsApp is worse than literal — it has
its own syntax where `*` means bold, so `**GST deadline**` posts to WhatsApp as
a bold asterisk.

── AND THE HASHTAGS ARE PARSED BACK OUT OF THE PROSE ────────────────────────

Because the prompt returns a blob, three call sites in `routers/hub.py` (lines
752, 2657, 3089) recover the tags with a regular expression:

    hashtags = re.findall(r'#\\w+', result["text"])

`re.findall` on that pattern keeps the `#`, so the column holds `['#GST', ...]`.
`social_publisher.py:690` then appends the column to the body it is already
inside:

    text += "\\n\\n" + " ".join(f"#{h}" for h in item["hashtags"])

Two consequences, both visible on the published post: every tag is doubled once
in prose and once in the appended block, and the appended copy reads `##GST`.
A regex guessing at structure the model was never asked to produce is the whole
cause, and no amount of prompt polish fixes it — the model has to RETURN the
tags as a field.

── THE SHAPE THIS MODULE IMPOSES ────────────────────────────────────────────

Generate structure ONCE, render per destination. `RichDoc` is what the model
returns (see `services/skills/content_prompts.py` for the contract it is asked
for); the renderers here turn that one document into LinkedIn's Unicode
emphasis, WhatsApp's `*_~` syntax, Instagram's nothing-at-all, X's 280
characters, or real HTML for email — from the same fields, with no second model
call. A per-platform generation would cost a credit per platform and would
produce five posts that disagree about the deadline date.

Inline emphasis inside those fields is written in a small, fixed markdown
subset (`**bold**`, `*italic*`, `~~strike~~`, `` `code` ``) because that is the
one dialect every model emits reliably. It is a TRANSPORT, parsed exactly once
by `parse_inline` and never shipped: no destination here is handed the raw
string.
"""

from __future__ import annotations

import html as _html
import json
import re
from dataclasses import dataclass, field, replace
from typing import Iterable, Optional

# ── 1 · Inline emphasis: parsed once, rendered per destination ────────────────


@dataclass(frozen=True)
class Span:
    """A run of text and the emphasis that applies to the whole run."""

    text: str
    bold: bool = False
    italic: bool = False
    strike: bool = False
    code: bool = False


#: The markdown subset accepted on the wire, in match order.
#:
#: `***x***` is tried before `**x**` and `**x**` before `*x*`, because regex
#: alternation is ordered and the shorter pattern would otherwise match the
#: first two asterisks of a bold run and leave the closing pair stranded in the
#: text — which is what `fill_prompt` had to be written to stop happening to
#: braces, one layer up.
#:
#: Underscores are deliberately NOT an italic marker. Underscores are ordinary
#: characters in the URLs and file names this product's copy carries
#: (`kartavaya.com/gst_ready`), and there is no escape syntax on the far side to
#: undo a wrong guess.
_INLINE = re.compile(
    r"\*\*\*(?P<bi>[^\n]+?)\*\*\*"
    r"|\*\*(?P<b>[^\n]+?)\*\*"
    r"|~~(?P<s>[^\n]+?)~~"
    r"|(?<!\*)\*(?P<i>[^*\n]+?)\*(?!\*)"
    r"|`(?P<c>[^`\n]+?)`"
)


def parse_inline(text: str) -> list[Span]:
    """Split one line of the transport dialect into emphasis spans.

    Unmatched markers stay in the text as themselves. That is on purpose and
    matches `services/skills/prompt.fill_prompt`: a visible stray asterisk gets
    the prompt fixed, while silently deleting it produces confident output that
    nobody can tell is wrong.
    """
    if not text:
        return []

    spans: list[Span] = []
    pos = 0
    for m in _INLINE.finditer(text):
        if m.start() > pos:
            spans.append(Span(text[pos:m.start()]))
        if m.group("bi") is not None:
            spans.append(Span(m.group("bi"), bold=True, italic=True))
        elif m.group("b") is not None:
            spans.append(Span(m.group("b"), bold=True))
        elif m.group("s") is not None:
            spans.append(Span(m.group("s"), strike=True))
        elif m.group("i") is not None:
            spans.append(Span(m.group("i"), italic=True))
        else:
            spans.append(Span(m.group("c"), code=True))
        pos = m.end()
    if pos < len(text):
        spans.append(Span(text[pos:]))
    return spans


def plain_text(text: str) -> str:
    """The same line with every marker removed and no emphasis substituted."""
    return "".join(s.text for s in parse_inline(text))


# ── 2 · Unicode emphasis, and why it is quarantined here ─────────────────────
#
# ACCESSIBILITY WARNING — READ BEFORE COPYING THIS ANYWHERE.
#
# The characters below are Mathematical Alphanumeric Symbols. They are NOT
# styled letters; they are separate codepoints that happen to look bold. A
# screen reader announces them one at a time, phonetically, or skips them —
# "𝗚𝗦𝗧 𝗱𝗲𝗮𝗱𝗹𝗶𝗻𝗲" is read as gibberish, letter by letter, not as two words.
# LinkedIn's own search does not index them either, so a bolded keyword stops
# being findable.
#
# They exist here for exactly one reason: LinkedIn's post field is plain text
# and offers NO alternative, so the choice is between this and no emphasis at
# all. Everywhere a real emphasis mechanism exists — HTML for email, markdown
# for the in-app editor and Reddit, `*` for WhatsApp — that mechanism is used
# and this mapper is not reachable. It must never be used in Kartavya's own UI,
# where `<strong>` and the `k-*` classes are right there and cost a screen
# reader user nothing.
#
# Hashtags never reach it either: `_tag_block` builds the tag line straight
# from the bare strings and never passes them through `_emphasise`. A bolded
# hashtag is not a hashtag on any platform here — the mapped characters are not
# the letters the tag is indexed under, so it silently stops matching.

_SANS_BOLD_UPPER = 0x1D5D4        # MATHEMATICAL SANS-SERIF BOLD CAPITAL A
_SANS_BOLD_LOWER = 0x1D5EE        # MATHEMATICAL SANS-SERIF BOLD SMALL A
_SANS_BOLD_DIGIT = 0x1D7EC        # MATHEMATICAL SANS-SERIF BOLD DIGIT ZERO
_SANS_ITALIC_UPPER = 0x1D608      # MATHEMATICAL SANS-SERIF ITALIC CAPITAL A
_SANS_ITALIC_LOWER = 0x1D622      # MATHEMATICAL SANS-SERIF ITALIC SMALL A
_SANS_BOLD_ITALIC_UPPER = 0x1D63C
_SANS_BOLD_ITALIC_LOWER = 0x1D656


def _ascii_table(upper: int, lower: int, digit: Optional[int] = None) -> dict[int, str]:
    """A translation table with exactly 52 (or 62) ASCII keys and nothing else.

    THIS IS THE DEVANAGARI GUARANTEE, and it is structural rather than a check
    somewhere that can be forgotten. The obvious mapper tests `ch.isalpha()` and
    offsets from `ord('a')` — but `'क'.isalpha()` is True, and Devanagari sits
    at U+0900–U+097F where that arithmetic lands in the middle of an unrelated
    block. Hindi copy comes out as mojibake, and matras (which are combining
    marks, not letters) detach from their consonants.

    Mathematical Alphanumeric Symbols has no Devanagari range and never will —
    Unicode does not encode style variants of Indic scripts, because Devanagari
    weight is a FONT property. So the only correct behaviour for `क` is to pass
    it through untouched, which is precisely what `str.translate` does with a
    key that is not in the table. Nothing is deleted, nothing is offset, and
    Hindi survives a transform it was never a candidate for.

    Sans-serif is chosen over the serif Mathematical Bold at U+1D400 for two
    reasons: it matches the sans stack LinkedIn actually renders in, and the
    sans-serif ranges are CONTIGUOUS. The serif italic range has a hole at
    U+1D455 — reserved, because MATHEMATICAL ITALIC SMALL H is unified with
    U+210E PLANCK CONSTANT — so a naive serif-italic mapper emits an
    unassigned codepoint for every letter `h`, and `the` renders as a tofu box.
    """
    table: dict[int, str] = {}
    for i in range(26):
        table[ord("A") + i] = chr(upper + i)
        table[ord("a") + i] = chr(lower + i)
    if digit is not None:
        for i in range(10):
            table[ord("0") + i] = chr(digit + i)
    return table


_BOLD_TABLE = _ascii_table(_SANS_BOLD_UPPER, _SANS_BOLD_LOWER, _SANS_BOLD_DIGIT)
#: No digits. Unicode has sans-serif BOLD digits but no sans-serif ITALIC ones,
#: so italicising "20 August" would leave the numerals in a visibly different
#: weight from the word beside them. Digits stay ASCII, which also keeps a date
#: — the one part of a compliance post a reader must be able to copy — readable
#: to a screen reader even inside an italic run.
_ITALIC_TABLE = _ascii_table(_SANS_ITALIC_UPPER, _SANS_ITALIC_LOWER)
_BOLD_ITALIC_TABLE = _ascii_table(_SANS_BOLD_ITALIC_UPPER, _SANS_BOLD_ITALIC_LOWER)


def to_unicode_bold(text: str) -> str:
    """Sans-serif Unicode bold. See the accessibility warning above."""
    return text.translate(_BOLD_TABLE)


def to_unicode_italic(text: str) -> str:
    """Sans-serif Unicode italic. See the accessibility warning above."""
    return text.translate(_ITALIC_TABLE)


def to_unicode_bold_italic(text: str) -> str:
    """Sans-serif Unicode bold italic. See the accessibility warning above."""
    return text.translate(_BOLD_ITALIC_TABLE)


# ── 3 · Emoji: a register, not a sprinkle ────────────────────────────────────
#
# Today one instruction covers every content type: QUICK_SKILL_PROMPTS tells
# the model "Include relevant emojis naturally" for a WhatsApp broadcast and
# for a business PROPOSAL, from the same file. A firm posting its GST return
# deadline and a firm posting a Diwali greeting are not in the same register,
# and a rocket on a statutory notice reads as either careless or a scam.
#
# So the register is a property of the CONTENT TYPE. The prompt states it (so
# the model writes to it) and `apply_emoji_policy` enforces it (so a model that
# ignores the instruction still cannot ship a wall of emoji). Both, because the
# prompt decides quality and the enforcement decides what a customer can be
# shown — and only one of those is allowed to depend on a model behaving.

#: Codepoint ranges treated as emoji. Deliberately narrower than "everything
#: pictographic": © U+00A9, ® U+00AE and ™ U+2122 are excluded because they are
#: business text in this product's copy, not decoration, and stripping a firm's
#: registered-trademark mark would be a legal edit rather than a stylistic one.
#: Arrows at U+2190–U+21FF are excluded for the same reason — `→` is punctuation
#: in a pricing line. Devanagari (U+0900–U+097F) is nowhere near any of these,
#: so the danda `।` and double danda `॥` are never mistaken for ornament.
_EMOJI_RANGES: tuple[tuple[int, int], ...] = (
    (0x1F000, 0x1FAFF),   # emoticons, transport, symbols, extended-A, tiles
    (0x2600, 0x27BF),     # miscellaneous symbols and dingbats
    (0x2B00, 0x2BFF),     # arrows/stars used as emoji (⭐ ⬆ ⬇)
    (0x2934, 0x2935),
    (0x3030, 0x3030),
    (0x303D, 0x303D),
    (0x3297, 0x3299),
    (0x203C, 0x203C),
    (0x2049, 0x2049),
    (0x24C2, 0x24C2),
)

#: Absorbed into whichever cluster precedes them: variation selectors, the ZWJ
#: that welds 👩 + 💻 into one glyph, the five skin-tone modifiers, the keycap
#: combiner, and the tag characters used by subdivision flags. Counting these
#: as separate emoji would report 👩‍💻 as two and 🏴󠁧󠁢󠁳󠁣󠁴󠁿 as eight.
_EMOJI_MODIFIERS = frozenset(
    {0xFE0E, 0xFE0F, 0x20E3, 0x200D}
    | set(range(0x1F3FB, 0x1F400))
    | set(range(0xE0020, 0xE0080))
)

#: `1️⃣` is ASCII `1` + U+FE0F + U+20E3. The base character is a plain digit, so
#: a scanner keyed only on the ranges above would count the combiner and leave
#: the digit stranded in the text.
_KEYCAP_BASES = frozenset("0123456789#*")


def _is_emoji_base(ch: str) -> bool:
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in _EMOJI_RANGES)


def emoji_clusters(text: str) -> list[tuple[int, int]]:
    """(start, end) of every emoji in `text`, one entry per rendered glyph."""
    out: list[tuple[int, int]] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        start_here = _is_emoji_base(ch) or (
            ch in _KEYCAP_BASES
            and i + 1 < n
            and ord(text[i + 1]) in (0xFE0F, 0x20E3)
        )
        if not start_here:
            i += 1
            continue
        j = i + 1
        # A flag is a PAIR of regional indicators — 🇮🇳 is U+1F1EE U+1F1F3, two
        # base characters and one glyph. Absorbed here, or the ceiling counts
        # every flag twice and cuts one in half, which renders as two unrelated
        # letters in a box.
        if 0x1F1E6 <= ord(ch) <= 0x1F1FF and j < n and 0x1F1E6 <= ord(text[j]) <= 0x1F1FF:
            j += 1
        while j < n:
            cp = ord(text[j])
            if cp == 0x200D and j + 1 < n:
                j += 2          # ZWJ welds the next glyph into this cluster
            elif cp in _EMOJI_MODIFIERS:
                j += 1
            else:
                break
        out.append((i, j))
        i = j
    return out


def count_emoji(text: str) -> int:
    return len(emoji_clusters(text))


def _drop_clusters(text: str, spans: Iterable[tuple[int, int]]) -> str:
    """Remove the given clusters and tidy the whitespace they leave behind."""
    keep: list[str] = []
    prev = 0
    for start, end in spans:
        keep.append(text[prev:start])
        prev = end
    keep.append(text[prev:])
    out = "".join(keep)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r" +([,.!?;:])", r"\1", out)
    return out.strip()


def strip_emoji(text: str) -> str:
    return _drop_clusters(text, emoji_clusters(text))


@dataclass(frozen=True)
class EmojiPolicy:
    """How much ornament one content type is allowed, and where."""

    name: str
    #: Hard ceiling across the whole document. Zero means none at all.
    max_total: int
    allow_in_headline: bool
    #: One line handed to the model verbatim, so the prompt and the enforcement
    #: below can never describe different rules.
    brief: str


REGISTERS: dict[str, EmojiPolicy] = {
    "statutory": EmojiPolicy(
        "statutory", 0, False,
        "Use NO emoji. This is a statutory or financial notice — a due date, a "
        "return, a demand, a penalty. Ornament on it reads as a scam and gets "
        "the firm's message ignored. Carry emphasis with structure and wording.",
    ),
    "professional": EmojiPolicy(
        "professional", 2, False,
        "At most two emoji in the whole piece, and none in the headline. Use "
        "them only where one replaces a word — a calendar for a date, a "
        "checkmark for a completed step. Never as decoration at the end of a "
        "line.",
    ),
    "conversational": EmojiPolicy(
        "conversational", 6, True,
        "Emoji are welcome but must each do a job: lead a list item, mark a "
        "step, carry a feeling the sentence does not. No strings of three, no "
        "rocket or fire on a business claim.",
    ),
    "festive": EmojiPolicy(
        "festive", 12, True,
        "This is a greeting or a festival campaign, so warmth is the point. "
        "Prefer emoji that match the occasion in an Indian context — a diya, "
        "rangoli, sweets, a marigold — over generic party icons.",
    ),
}

#: Content type → register. Keyed on the `agent_type` values already stored in
#: `hub_content_items.agent_type` plus the `QUICK_SKILL_PROMPTS` skill names, so
#: a caller can pass whichever of the two it holds without translating first.
CONTENT_REGISTERS: dict[str, str] = {
    # Statutory and financial: the register exists for these.
    "compliance": "statutory",
    "compliance_alert": "statutory",
    "statutory_notice": "statutory",
    "tax_deadline": "statutory",
    "invoice_reminder": "statutory",
    "payment_reminder": "statutory",
    # Considered business writing.
    "blog": "professional",
    "blog_post": "professional",
    "seo": "professional",
    "campaign": "professional",
    "lead_magnet": "professional",
    "proposal": "professional",
    "email": "professional",
    "email_campaign": "professional",
    "ad_analysis": "professional",
    "case_study": "professional",
    # Copy that is meant to sound like a person.
    "social_media": "conversational",
    "social_post": "conversational",
    "ad_copy": "conversational",
    "whatsapp": "conversational",
    "whatsapp_broadcast": "conversational",
    "announcement": "conversational",
    # Greetings.
    "festival_campaign": "festive",
    "festival_greeting": "festive",
    "greeting": "festive",
    "milestone": "festive",
}

DEFAULT_REGISTER = "professional"


def register_for(content_type: Optional[str]) -> str:
    return CONTENT_REGISTERS.get((content_type or "").strip().lower(), DEFAULT_REGISTER)


def policy_for(
    content_type: Optional[str] = None,
    register: Optional[str] = None,
    emoji: Optional[bool] = None,
) -> EmojiPolicy:
    """Resolve the policy, with `emoji=False` as the customer's off switch.

    The off switch is absolute and is not a register — a firm that has told us
    it wants no emoji anywhere means it for the Diwali post too, and folding
    that preference into "statutory" would silently re-enable it the moment
    someone re-tagged the content type.
    """
    if emoji is False:
        return replace(REGISTERS["statutory"], name="off")
    name = (register or "").strip().lower() or register_for(content_type)
    return REGISTERS.get(name, REGISTERS[DEFAULT_REGISTER])


# ── 4 · The document ─────────────────────────────────────────────────────────


@dataclass
class RichDoc:
    """What the model returns, and the only thing the renderers read.

    Every text field carries the inline transport dialect from §1. `hashtags`
    are stored BARE — no leading `#`. That is the fix for the `##GST` on every
    published post: `social_publisher.py:690` formats each stored tag as
    `f"#{h}"`, and the regex that used to fill that column captured the `#` too.
    One place decides where the hash goes, and it is the renderer.
    """

    headline: str = ""
    body: list[str] = field(default_factory=list)
    bullets: list[str] = field(default_factory=list)
    call_to_action: str = ""
    hashtags: list[str] = field(default_factory=list)
    #: Email preheader. Rendered by the email destination and ignored elsewhere.
    preview: str = ""
    #: Whatever else a content type needs (meta description, keywords, subject
    #: variants). Carried so a caller can store it; never rendered, because a
    #: field no renderer knows about must not leak into a published post.
    extras: dict = field(default_factory=dict)

    def title(self, limit: int = 100) -> str:
        """A plain-text title for `hub_content_items.title`.

        Today that column is `body.brief[:100]` — the customer's own prompt,
        truncated. The headline the model wrote is a better name for the row and
        costs nothing extra, since it is already in the response.
        """
        text = plain_text(self.headline).strip()
        if not text:
            for para in self.body:
                text = plain_text(para).strip()
                if text:
                    break
        return text[:limit]

    def is_empty(self) -> bool:
        return not any(
            (self.headline.strip(), self.call_to_action.strip(),
             [p for p in self.body if p.strip()],
             [b for b in self.bullets if b.strip()])
        )

    def to_dict(self) -> dict:
        return {
            "headline": self.headline,
            "body": list(self.body),
            "bullets": list(self.bullets),
            "call_to_action": self.call_to_action,
            "hashtags": list(self.hashtags),
            "preview": self.preview,
            "extras": dict(self.extras),
        }


_TAG_CHARS = re.compile(r"[^0-9A-Za-zऀ-ॿ_]+")


def normalise_hashtag(tag: str) -> str:
    """One bare, postable tag — or "" if nothing usable is left.

    Devanagari is kept in the character class on purpose: `#कर` and `#दिवाली`
    are real, working hashtags on every platform here, and a class of
    `[^0-9A-Za-z_]` would erase a Hindi tag down to the empty string. Spaces are
    removed rather than replaced with `_`, because `#GST Filing` on Instagram
    tags "GST" and posts the word "Filing" — the tag has to be one token before
    it is ever sent.
    """
    tag = (tag or "").strip().lstrip("#").strip()
    tag = _TAG_CHARS.sub("", tag)
    return tag


def _as_list(value, *, limit: int = 24) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        parts = [p for p in re.split(r"[\r\n]+", value) if p.strip()]
    elif isinstance(value, (list, tuple)):
        parts = []
        for item in value:
            if isinstance(item, dict):
                # Models like returning [{"text": "..."}] when asked for bullets.
                item = item.get("text") or item.get("value") or ""
            if str(item).strip():
                parts.append(str(item))
    else:
        parts = [str(value)]
    return [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", p).strip() for p in parts][:limit]


_JSON_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
_JSON_BARE = re.compile(r"\{.*\}", re.DOTALL)


def from_dict(data: dict) -> RichDoc:
    """Build a document from a parsed JSON object, tolerating the near misses.

    Key aliases are accepted rather than rejected because the failure they
    prevent is expensive and silent: a refused document falls back to
    `from_plain_text`, the post loses its bullets and its tags, and nothing in
    the response says so. Every alias here is a name a model has a reason to
    reach for; none of them changes what a field MEANS.
    """
    if not isinstance(data, dict):
        return RichDoc()

    def pick(*names, default=None):
        for n in names:
            if n in data and data[n] not in (None, ""):
                return data[n]
        return default

    tags = []
    for raw in _as_list(pick("hashtags", "tags", "hash_tags", default=[]), limit=40):
        for piece in raw.split():
            tag = normalise_hashtag(piece)
            if tag and tag.casefold() not in {t.casefold() for t in tags}:
                tags.append(tag)

    known = {
        "headline", "title", "hook", "subject", "subject_line",
        "body", "paragraphs", "content", "text",
        "bullets", "points", "key_points", "list",
        "call_to_action", "cta", "closing",
        "hashtags", "tags", "hash_tags",
        "preview", "preview_text", "preheader",
        # `to_dict` emits this key, and a document rehydrated from
        # `hub_content_items.metadata` has to come back the shape it went in.
        # Without it the round trip nests: extras becomes {"extras": {...}}.
        "extras",
    }
    extras = dict(data.get("extras") or {}) if isinstance(data.get("extras"), dict) else {}
    extras.update({k: v for k, v in data.items() if k not in known})
    return RichDoc(
        headline=str(pick("headline", "title", "hook", "subject", "subject_line", default="")).strip(),
        body=_as_list(pick("body", "paragraphs", "content", "text", default=[])),
        bullets=_as_list(pick("bullets", "points", "key_points", "list", default=[])),
        call_to_action=str(pick("call_to_action", "cta", "closing", default="")).strip(),
        hashtags=tags,
        preview=str(pick("preview", "preview_text", "preheader", default="")).strip(),
        extras=extras,
    )


def from_plain_text(text: str) -> RichDoc:
    """Last resort: a prose blob, split on the shape it already has.

    This is the OLD behaviour, kept only as the fallback. It is here so a model
    that ignores the JSON contract degrades to today's quality instead of a 500
    on a request the customer has already been charged for — `generate_content`
    refunds a provider exception, not a parse failure, so a raise here would
    take the credit and return nothing.
    """
    lines = [ln.rstrip() for ln in (text or "").strip().splitlines()]
    headline, body, bullets, tags = "", [], [], []
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        stripped = re.sub(r"^#{1,6}\s+", "", line)
        if not headline and (stripped != line or (len(body) == 0 and len(stripped) <= 120)):
            headline = stripped
            continue
        if re.match(r"^\s*(?:[-*•]|\d+[.)])\s+", raw):
            bullets.append(re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", raw).strip())
            continue
        words = line.split()
        if words and all(w.startswith("#") for w in words):
            tags.extend(filter(None, (normalise_hashtag(w) for w in words)))
            continue
        body.append(line)
    # Tags written inline mid-sentence still have to come out of the prose, or
    # the renderer emits them twice — once in the paragraph and once in the tag
    # block. That doubling is the published bug this module exists to end.
    cleaned_body = []
    for para in body:
        for word in re.findall(r"(?<!\w)#([0-9A-Za-zऀ-ॿ_]+)", para):
            tag = normalise_hashtag(word)
            if tag and tag.casefold() not in {t.casefold() for t in tags}:
                tags.append(tag)
        para = re.sub(r"\s*(?<!\w)#[0-9A-Za-zऀ-ॿ_]+", "", para).strip()
        if para:
            cleaned_body.append(para)
    return RichDoc(headline=headline, body=cleaned_body, bullets=bullets, hashtags=tags)


def from_model_output(text: str) -> RichDoc:
    """Parse whatever the model actually returned into one document."""
    if not text or not text.strip():
        return RichDoc()

    for pattern in (_JSON_FENCE, _JSON_BARE):
        match = pattern.search(text)
        if not match:
            continue
        try:
            data = json.loads(match.group(1) if pattern is _JSON_FENCE else match.group(0))
        except (ValueError, TypeError):
            continue
        doc = from_dict(data)
        if not doc.is_empty():
            return doc
    return from_plain_text(text)


def _leading_cluster(text: str) -> Optional[tuple[int, int]]:
    """The emoji a line OPENS with, if it opens with one."""
    stripped = text.lstrip()
    offset = len(text) - len(stripped)
    clusters = emoji_clusters(text)
    if clusters and clusters[0][0] == offset:
        return clusters[0]
    return None


def apply_emoji_policy(doc: RichDoc, policy: EmojiPolicy) -> RichDoc:
    """Bring a document down to what its register allows. Never adds anything.

    The renderers below never invent an emoji, and neither does this: judgement
    about WHICH emoji belongs is the model's job under a briefed register, and a
    bullet leader chosen by a lookup table is the sprinkle the owner complained
    about. This is the ceiling, not the author.

    ── WHAT SURVIVES THE CEILING, AND WHY IT IS NOT SIMPLY THE FIRST N ─────

    An emoji that OPENS a list item is structural — it is the bullet, and
    dropping it leaves the others in the list wearing one. An emoji anywhere
    else is decoration, and decoration is what a post overruns on: the
    "🚀🔥💯" at the end of the call to action.

    So bullet leaders are paid first, out of the whole budget, and only what is
    left over is spent on everything else in reading order. Ordering the two
    the other way — the obvious "keep the first N clusters" — let three
    decorative emoji in the opening paragraph starve every bullet in the list,
    which is the opposite of the rule this policy is supposed to express.
    """
    headline = doc.headline if policy.allow_in_headline else strip_emoji(doc.headline)
    # A tagged emoji is not a tag on any platform here; it either breaks the tag
    # or is silently dropped by the platform, so it comes off unconditionally.
    hashtags = [t for t in (normalise_hashtag(strip_emoji(t)) for t in doc.hashtags) if t]

    if policy.max_total <= 0:
        return replace(
            doc,
            headline=strip_emoji(headline),
            body=[strip_emoji(p) for p in doc.body],
            bullets=[strip_emoji(b) for b in doc.bullets],
            call_to_action=strip_emoji(doc.call_to_action),
            hashtags=hashtags,
        )

    budget = policy.max_total
    leaders = [_leading_cluster(b) for b in doc.bullets]
    kept_leaders = 0
    for index, leader in enumerate(leaders):
        if leader is None:
            continue
        if kept_leaders < budget:
            kept_leaders += 1
        else:
            leaders[index] = None      # over budget: this bullet loses its mark
    budget -= kept_leaders

    def spend(text: str, protect: Optional[tuple[int, int]] = None) -> str:
        nonlocal budget
        clusters = [c for c in emoji_clusters(text) if c != protect]
        keep = clusters[:max(budget, 0)]
        budget -= len(keep)
        return _drop_clusters(text, [c for c in clusters if c not in keep])

    headline = spend(headline)
    out_body = [spend(p) for p in doc.body]
    out_bullets = [spend(b, protect=leaders[i]) for i, b in enumerate(doc.bullets)]
    cta = spend(doc.call_to_action)

    return replace(
        doc, headline=headline, body=out_body, bullets=out_bullets,
        call_to_action=cta, hashtags=hashtags,
    )


# ── 5 · Destinations ─────────────────────────────────────────────────────────

EMPHASIS_PLAIN = "plain"
EMPHASIS_UNICODE = "unicode"
EMPHASIS_WHATSAPP = "whatsapp"
EMPHASIS_MARKDOWN = "markdown"
EMPHASIS_HTML = "html"

#: How the BLOCKS are built, which is a separate question from how a word is
#: emphasised — and conflating the two is what sent Telegram a `<h2>`.
#: `sendMessage(parse_mode="HTML")` accepts inline tags (b/strong, i/em, s,
#: code, a, pre, blockquote) and answers anything else with 400 "can't parse
#: entities: Unsupported start tag", so Telegram wants HTML emphasis inside a
#: FLAT document: no headings, no `<p>`, no `<ul>`. Email is the opposite — a
#: real HTML document — and it is the only destination that gets one.
LAYOUT_FLAT = "flat"
LAYOUT_MARKDOWN = "markdown"
LAYOUT_HTML = "html"


@dataclass(frozen=True)
class Destination:
    key: str
    emphasis: str
    #: Hard character ceiling the platform enforces. 0 means none worth
    #: modelling. Overrunning is not a soft failure — the API rejects the post
    #: or the platform truncates mid-word in public.
    limit: int
    #: How many tags this destination should carry. NOT the platform maximum:
    #: Instagram permits 30 and recommends three to five, and thirty tags is the
    #: slop the owner is complaining about.
    hashtag_cap: int
    bullet: str = "• "
    label: str = ""
    layout: str = LAYOUT_FLAT


#: Keys are the values `hub_social_accounts.platform` actually holds — the
#: `publish_to_*` function names in `services/social_publisher.py` — plus the
#: two destinations that never go through a social account.
DESTINATIONS: dict[str, Destination] = {
    # LinkedIn: plain-text `shareCommentary.text`. Unicode emphasis is the only
    # mechanism the field leaves, at the accessibility cost documented in §2.
    # Three tags: LinkedIn stopped treating hashtags as a discovery surface and
    # a tag wall now reads as spam to the feed ranker.
    "linkedin": Destination("linkedin", EMPHASIS_UNICODE, 3000, 3, label="LinkedIn"),
    # Instagram: captions render no formatting whatsoever — no markdown, no
    # Unicode trick worth the screen-reader cost on a surface that is already
    # image-first. Line breaks, emoji and tags carry all the structure. 2,200
    # characters, of which only the first 125 show before "… more".
    "instagram": Destination("instagram", EMPHASIS_PLAIN, 2200, 8, label="Instagram"),
    # WhatsApp Cloud API text body. Its own syntax, and the one destination
    # where markdown asterisks are actively harmful rather than merely visible.
    # No tags: hub.py's own prompt already says "No hashtags (not a WhatsApp
    # thing)" and it is right.
    "whatsapp": Destination("whatsapp", EMPHASIS_WHATSAPP, 4096, 0, label="WhatsApp"),
    "x": Destination("x", EMPHASIS_PLAIN, 280, 2, label="X"),
    "facebook": Destination("facebook", EMPHASIS_PLAIN, 63206, 3, label="Facebook"),
    "threads": Destination("threads", EMPHASIS_PLAIN, 500, 3, label="Threads"),
    "tiktok": Destination("tiktok", EMPHASIS_PLAIN, 2200, 5, label="TikTok"),
    "pinterest": Destination("pinterest", EMPHASIS_PLAIN, 500, 4, label="Pinterest"),
    "youtube": Destination("youtube", EMPHASIS_PLAIN, 5000, 5, label="YouTube"),
    # Google Business Profile local posts: plain text, no tags — the surface is
    # a search result, and a hashtag in one is noise.
    "google_business": Destination("google_business", EMPHASIS_PLAIN, 1500, 0, label="Google Business"),
    # Reddit's submit API takes markdown in `text`, which makes it the one
    # social destination that gets real emphasis. Hashtags mean nothing there.
    "reddit": Destination("reddit", EMPHASIS_MARKDOWN, 40000, 0, label="Reddit",
                          layout=LAYOUT_MARKDOWN),
    # Telegram sendMessage is called with parse_mode="HTML" — inline tags only,
    # inside a FLAT document. It rejects the whole message on an unsupported
    # tag, so this is not cosmetic: rendered as an HTML document, every
    # Telegram publish 400s, where the raw markdown it replaced at least
    # posted. It also enforces the 4,096, so the layout has to be one that
    # goes through `_fit`. Note that `publish_to_telegram` drops to sendPhoto
    # when there is media, and THAT caption is plain text — so a Telegram post
    # with an image must be rendered as "telegram_caption", not as "telegram".
    "telegram": Destination("telegram", EMPHASIS_HTML, 4096, 0, label="Telegram"),
    "telegram_caption": Destination("telegram_caption", EMPHASIS_PLAIN, 1024, 0, label="Telegram caption"),
    # Not social accounts: the email body, the website page body and the in-app
    # editor, all of which have a real emphasis mechanism and must never see
    # the Unicode mapper.
    "email": Destination("email", EMPHASIS_HTML, 0, 0, label="Email",
                         layout=LAYOUT_HTML),
    # The Generate form offers "Website", and a page body is HTML the same way
    # an email body is — headings and lists are what publishes there. Without a
    # row of its own it resolved to the in-app editor and the customer got
    # markdown source to paste into a CMS.
    "website": Destination("website", EMPHASIS_HTML, 0, 0, label="Website",
                           layout=LAYOUT_HTML),
    # Google ADS, which is not Google Business Profile: an editor with per-FIELD
    # caps (headline 30, description 90) rather than one post budget, so `limit`
    # stays 0 and `content_prompts.destination_brief` states the field caps
    # instead. Plain text, and a hashtag in an ad is wasted characters.
    "google_ads": Destination("google_ads", EMPHASIS_PLAIN, 0, 0, label="Google Ads"),
    "markdown": Destination("markdown", EMPHASIS_MARKDOWN, 0, 0, bullet="- ",
                            label="In-app editor", layout=LAYOUT_MARKDOWN),
}

#: Every spelling a caller might already be holding. `hub_social_accounts`
#: stores "whatsapp_business"; `ContentGenerate.platform` is free text a screen
#: filled in, so "Twitter" and "WhatsApp" arrive as typed.
#:
#: The eight strings `frontend/src/pages/sahayak/platformText.PLATFORMS` sends
#: are the ones that MUST land, and three of them carry a separator this table
#: never held: "Twitter / X", "Google Ads", "Website". They fell through to the
#: in-app editor, so a tweet was rendered as a markdown heading with no tags
#: and no 280-character fit — silently, because falling back to markdown is
#: also the correct answer for a platform nobody recognises. `_squash` below is
#: what stops a space from deciding that.
_ALIASES: dict[str, str] = {
    "whatsapp_business": "whatsapp",
    "whatsapp business": "whatsapp",
    "wa": "whatsapp",
    "twitter": "x",
    "x (twitter)": "x",
    "twitter/x": "x",
    "fb": "facebook",
    "meta": "facebook",
    "ig": "instagram",
    "gbp": "google_business",
    "google business profile": "google_business",
    "google_my_business": "google_business",
    "linked in": "linkedin",
    "yt": "youtube",
    "in_app": "markdown",
    "app": "markdown",
    "editor": "markdown",
    # "web" is the web APP — the in-app editor — and not the `website`
    # destination beside it, which is a page body and gets real HTML.
    "web": "markdown",
    "md": "markdown",
    "blog": "markdown",
    "newsletter": "email",
    "mail": "email",
    "html": "email",
    "general": "markdown",
    "": "markdown",
}


_SEPARATORS = re.compile(r"[^a-z0-9]+")


def _squash(name: str) -> str:
    """A platform name with every separator removed.

    "Twitter / X", "twitter/x", "Twitter-X" and "twitterx" are one platform
    written four ways, and the only thing separating them is punctuation a form
    label chose. `frontend/src/pages/sahayak/platformText.platformKey` already
    normalises this way for exactly the same reason, so matching it here keeps
    the two ends of the wire agreeing on what a name means.
    """
    return _SEPARATORS.sub("", (name or "").lower())


#: Destination keys first so every canonical name resolves under any spelling,
#: then the aliases, which is the only direction that can add a meaning rather
#: than change one.
_SQUASHED: dict[str, str] = {_squash(k): k for k in DESTINATIONS}
_SQUASHED.update({_squash(k): v for k, v in _ALIASES.items()})


def resolve_destination(name: Optional[str]) -> Destination:
    """Map a platform string to a destination, defaulting to the in-app editor.

    An unknown platform falls back to markdown rather than raising. The platform
    column is free text on `ContentGenerate` and a customer can type anything
    into it; refusing the generation over a spelling would take a credit and
    return an error, while markdown is the one dialect that is merely
    unformatted rather than wrong when it lands somewhere unexpected.

    That fallback is also why the punctuation-insensitive lookup matters more
    here than it looks: a name this table misses does not fail loudly, it
    quietly publishes the wrong shape.
    """
    key = (name or "").strip().lower().replace("-", "_")
    key = _ALIASES.get(key, key)
    if key in DESTINATIONS:
        return DESTINATIONS[key]
    return DESTINATIONS.get(_SQUASHED.get(_squash(name), ""), DESTINATIONS["markdown"])


# ── 6 · Rendering ────────────────────────────────────────────────────────────


def _maps_whole_run(text: str) -> bool:
    """True when every character the Unicode tables are expected to style is
    one they actually hold.

    Keyed on letters and digits only. Punctuation, the danda `।`, the rupee
    sign and emoji stay upright in both weights, so their passing through is
    invisible — but `२०२६` in Devanagari digits beside an ASCII word is the
    same half-styled phrase a Hindi word is, and `.isalpha()` is False for it.
    """
    return not any(
        not ch.isascii() and (ch.isalpha() or ch.isdigit()) for ch in text
    )


def _emphasise(span: Span, emphasis: str) -> str:
    if emphasis == EMPHASIS_PLAIN:
        return span.text

    if emphasis == EMPHASIS_UNICODE:
        # Strikethrough is dropped to plain rather than faked with U+0336
        # combining overlays: the overlay is a second codepoint per letter, it
        # breaks LinkedIn's own line wrapping, and it compounds the screen
        # reader problem this whole branch already has.
        if span.code:
            return span.text
        # Unicode has sans-serif BOLD digits but no sans-serif ITALIC ones, so
        # an italic run containing a numeral comes out half-styled: `*14th*`
        # renders as an upright "14" beside a slanted "th", which reads as a
        # font fault rather than as emphasis. A run like that drops to bold if
        # it was asked for both, and otherwise stays plain — losing the
        # emphasis is cheaper than shipping a word that looks broken, and the
        # runs this catches are dates and amounts, the part of a compliance
        # post a reader most needs to be able to copy.
        # The same rule, for the far commoner case. `str.translate` passes
        # Devanagari through untouched — that is the guarantee in §2 and it is
        # right for the MAPPER — but a RUN is styled as a unit, and this
        # product's copy mixes scripts inside one run constantly: GST, TDS, ITR
        # and MCA are written in Latin inside Hindi, Gujarati and Marathi prose,
        # and so are the years. `**GST रिटर्न 2026**` came out as heavy
        # sans-serif around a regular-weight रिटर्न — two visible weights inside
        # one phrase, which is the font fault the digit rule above already
        # refuses. A run the tables cannot style END TO END is not styled.
        whole_run = _maps_whole_run(span.text)
        italic_ok = (
            span.italic
            and whole_run
            and not any(ch.isdigit() for ch in span.text)
        )
        if span.bold and italic_ok:
            return to_unicode_bold_italic(span.text)
        if span.bold and whole_run:
            return to_unicode_bold(span.text)
        if italic_ok:
            return to_unicode_italic(span.text)
        return span.text

    if emphasis == EMPHASIS_WHATSAPP:
        # Monospace short-circuits: WhatsApp gives ``` priority and renders the
        # other markers as literal characters if they are combined with it.
        if span.code:
            return f"```{span.text}```"
        out = span.text
        if span.strike:
            out = f"~{out}~"
        if span.italic:
            out = f"_{out}_"
        if span.bold:
            out = f"*{out}*"
        return out

    if emphasis == EMPHASIS_MARKDOWN:
        out = span.text
        if span.code:
            return f"`{out}`"
        if span.strike:
            out = f"~~{out}~~"
        if span.italic:
            out = f"*{out}*"
        if span.bold:
            out = f"**{out}**"
        return out

    # HTML. Escaped here, at the point the tag is added, for the same reason
    # `email_service.py` escapes at `_safe_subject` and nowhere else: one choke
    # point means a new field cannot be added that forgets.
    out = _html.escape(span.text, quote=False)
    if span.code:
        return f"<code>{out}</code>"
    if span.strike:
        out = f"<s>{out}</s>"
    if span.italic:
        out = f"<em>{out}</em>"
    if span.bold:
        out = f"<strong>{out}</strong>"
    return out


def _line(text: str, emphasis: str) -> str:
    return "".join(_emphasise(s, emphasis) for s in parse_inline(text))


def _tag_block(tags: list[str], cap: int) -> str:
    if cap <= 0 or not tags:
        return ""
    return " ".join(f"#{t}" for t in tags[:cap])


def _truncate(text: str, limit: int) -> str:
    """Cut to `limit` on a word boundary.

    Word boundaries, not characters: a space can never fall inside an emoji
    cluster (ZWJ sequences contain none), so cutting there cannot leave half a
    glyph — and half a glyph is a replacement box on the customer's public post.
    """
    if limit <= 0 or len(text) <= limit:
        return text
    cut = text[: max(limit - 1, 0)]
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip() + "…"


def _fit(sections: list[str], tags: str, limit: int, joiner: str = "\n\n") -> str:
    """Assemble within the budget, shedding from the least load-bearing end.

    Order matters and is a product decision: the call to action and the
    headline are what the post is FOR, so the detail in the middle goes first.
    X at 280 characters reaches the last branch on nearly every post, which is
    exactly why the branch has to cut on a word rather than a character.
    """
    parts = [s for s in sections if s]
    while True:
        body = joiner.join(parts)
        text = f"{body}\n\n{tags}" if tags else body
        if limit <= 0 or len(text) <= limit:
            return text.strip()
        if len(parts) > 2:
            del parts[-2]          # keep the last part: it is the call to action
            continue
        if tags:
            tags = ""
            continue
        if len(parts) > 1:
            parts.pop()
            continue
        return _truncate(text, limit)


_PARTIAL_TAG = re.compile(r"<[^>]*$")
_HTML_TAG = re.compile(r"</?([a-z]+)[^>]*>")

#: The exact worst case a repair can cost. `_emphasise` short-circuits on
#: `code`, so the deepest stack it can leave open is `<strong><em><s>`; closing
#: all three is these eighteen characters and never more. Reserved rather than
#: measured, because the alternative is fitting twice.
_CLOSER_RESERVE = len("</s></em></strong>")


def _close_open_tags(text: str) -> str:
    """Re-close whatever the character budget cut through.

    Reached on any HTML destination that carries a limit — Telegram today —
    and it is not cosmetic there: `sendMessage` answers 400 "can't parse
    entities" on an unclosed tag and drops the entire message, so a cut that
    lands between `<strong>` and its closer loses the post rather than its
    last word.
    """
    text = _PARTIAL_TAG.sub("", text)
    stack: list[str] = []
    for m in _HTML_TAG.finditer(text):
        if m.group(0).startswith("</"):
            if stack and stack[-1] == m.group(1):
                stack.pop()
        else:
            stack.append(m.group(1))
    return text + "".join(f"</{tag}>" for tag in reversed(stack))


def _render_flat(doc: RichDoc, dest: Destination) -> str:
    emphasis = dest.emphasis
    sections: list[str] = []
    if doc.headline.strip():
        sections.append(_line(doc.headline, emphasis))
    for para in doc.body:
        if para.strip():
            sections.append(_line(para, emphasis))
    if doc.bullets:
        sections.append("\n".join(
            f"{dest.bullet}{_line(b, emphasis)}" for b in doc.bullets if b.strip()
        ))
    if doc.call_to_action.strip():
        sections.append(_line(doc.call_to_action, emphasis))
    tags = _tag_block(doc.hashtags, dest.hashtag_cap)
    if emphasis != EMPHASIS_HTML:
        return _fit(sections, tags, dest.limit)
    # Fit short of the ceiling by the reserve, so re-closing a tag the cut
    # landed inside cannot itself put the message back over it.
    limit = max(dest.limit - _CLOSER_RESERVE, 1) if dest.limit else 0
    return _close_open_tags(_fit(sections, tags, limit))


def _render_markdown(doc: RichDoc, dest: Destination) -> str:
    sections: list[str] = []
    if doc.headline.strip():
        sections.append(f"## {_line(doc.headline, EMPHASIS_MARKDOWN)}")
    for para in doc.body:
        if para.strip():
            sections.append(_line(para, EMPHASIS_MARKDOWN))
    if doc.bullets:
        sections.append("\n".join(
            f"- {_line(b, EMPHASIS_MARKDOWN)}" for b in doc.bullets if b.strip()
        ))
    if doc.call_to_action.strip():
        # `plain_text` first, not `_line`: the call to action is being wrapped in
        # bold here, and a model that also wrote `**...**` inside it would
        # produce `****`, which every markdown renderer resolves as an empty
        # bold run followed by literal asterisks.
        sections.append(f"**{plain_text(doc.call_to_action)}**")
    return _fit(sections, _tag_block(doc.hashtags, dest.hashtag_cap), dest.limit)


def _render_html(doc: RichDoc, dest: Destination) -> str:
    out: list[str] = []
    if doc.headline.strip():
        out.append(f"<h2>{_line(doc.headline, EMPHASIS_HTML)}</h2>")
    if doc.preview.strip() and dest.key == "email":
        # A preheader is for the inbox list, not the open message. `display:none`
        # rather than omitting it: without one the client scrapes the first
        # sentence of the body into the preview slot, which on a compliance mail
        # is the greeting and tells the reader nothing.
        out.append(
            '<span style="display:none;max-height:0;overflow:hidden">'
            f"{_html.escape(plain_text(doc.preview), quote=False)}</span>"
        )
    for para in doc.body:
        if para.strip():
            out.append(f"<p>{_line(para, EMPHASIS_HTML)}</p>")
    if doc.bullets:
        items = "".join(
            f"<li>{_line(b, EMPHASIS_HTML)}</li>" for b in doc.bullets if b.strip()
        )
        if items:
            out.append(f"<ul>{items}</ul>")
    if doc.call_to_action.strip():
        out.append(f"<p><strong>{_line(doc.call_to_action, EMPHASIS_HTML)}</strong></p>")
    tags = _tag_block(doc.hashtags, dest.hashtag_cap)
    if tags:
        out.append(f"<p>{_html.escape(tags, quote=False)}</p>")
    # Inert while the two document destinations both carry limit 0, and here
    # so that they cannot stop doing so quietly: this renderer used to ignore
    # its destination's ceiling outright, which is how Telegram was shipping
    # 5,045 characters against a declared 4,096.
    if not dest.limit:
        return "\n".join(out)
    return _close_open_tags(
        _fit(out, "", max(dest.limit - _CLOSER_RESERVE, 1), joiner="\n")
    )


def render(
    doc: RichDoc,
    destination: str,
    *,
    content_type: Optional[str] = None,
    register: Optional[str] = None,
    emoji: Optional[bool] = None,
) -> str:
    """Render one document for one destination.

    The emoji policy is applied HERE rather than at generation, so the same
    stored document can be published to a WhatsApp broadcast with its warmth
    intact and to a Google Business listing without it — one generation, one
    credit, and the register still honoured on both.
    """
    dest = resolve_destination(destination)
    doc = apply_emoji_policy(doc, policy_for(content_type, register, emoji))
    # On `layout`, not on `emphasis`. Branching on the emphasis is what handed
    # Telegram an `<h2>`: it wants HTML tags for a bold word and rejects them
    # for a heading, so the two questions are not the same question.
    if dest.layout == LAYOUT_HTML:
        return _render_html(doc, dest)
    if dest.layout == LAYOUT_MARKDOWN:
        return _render_markdown(doc, dest)
    return _render_flat(doc, dest)


def render_all(
    doc: RichDoc,
    destinations: Iterable[str],
    *,
    content_type: Optional[str] = None,
    register: Optional[str] = None,
    emoji: Optional[bool] = None,
) -> dict[str, str]:
    """The same document for several destinations, keyed by resolved name."""
    out: dict[str, str] = {}
    for name in destinations:
        dest = resolve_destination(name)
        out[dest.key] = render(
            doc, dest.key, content_type=content_type, register=register, emoji=emoji,
        )
    return out
