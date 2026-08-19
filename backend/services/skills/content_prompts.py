"""content_prompts.py — ask for a structure, not a blob.

Every content prompt in this product asks the model for prose and then guesses
at the structure afterwards. `routers/hub.py` AGENT_PROMPTS["social_media"] ends
"include relevant hashtags. Output the post text only", and three call sites
(lines 752, 2657 and 3089) recover the tags with `re.findall(r'#\\w+', ...)`.
A regex is the wrong tool for a job the model can simply do: asked for a
`hashtags` field, it returns one, and `services/social_publisher.py:690` stops
appending `##GST` under a paragraph that already carried the same tags.

The second half of the same defect is destination blindness.
QUICK_SKILL_PROMPTS["social_post"]["system"] says "Use markdown formatting:
**bold** for emphasis" and then, six lines later, "If LinkedIn, be more
professional and longer" — one blob of instructions covering LinkedIn (plain
text, renders nothing), Instagram (renders nothing), and WhatsApp (renders `*`
as bold, so `**word**` posts as a bold asterisk). No prompt can be right for
all three at once, because they disagree at the syntax level and not at the
tone level.

So the contract here asks for ONE document with named fields and a single
inline dialect, and `services/rich_content.py` renders it per destination. The
model is told what the surfaces need — the character budget, whether tags exist
there at all — so it writes to the tightest one, and it is told NOT to write
platform syntax, because it is not the thing that knows where this is going.

── ONE RULE FOR ANYONE EDITING THE TEMPLATES BELOW ──────────────────────────

Both callers substitute with `str.format()`:

    AGENT_PROMPTS[body.agent_type].format(platform=..., brief=..., extra=...)
    skill_cfg["prompt"].format(topic=..., platform=..., ...)

`.format()` treats every `{` as a placeholder and raises `KeyError` on any name
it was not handed — so a single literal brace in a template takes down the
whole generation AFTER the credit has been spent. That is why the JSON contract
lives in `RICH_DOC_CONTRACT` and is appended by `build_content_prompt`, never
interpolated: it is nothing but braces. `test_content_prompts.py` pins it.
"""

from typing import Iterable, Optional

from services.rich_content import (
    DESTINATIONS, REGISTERS, policy_for, register_for, resolve_destination,
)

# ── The document contract ────────────────────────────────────────────────────

#: Handed to the model verbatim. Contains literal braces and MUST NOT be passed
#: through `str.format()` — see the module docstring.
RICH_DOC_CONTRACT = """
Return ONE JSON object and nothing else. No preamble, no explanation, no code
fence. This exact shape:

{
  "headline":       "one line, the single most important thing you have to say",
  "body":           ["one paragraph per array entry, two to four entries"],
  "bullets":        ["three to five short concrete points, or [] if none fit"],
  "call_to_action": "one line telling the reader exactly what to do next",
  "hashtags":       ["BareTagsWithoutTheHashSymbol"],
  "preview":        "one line of inbox preview text, empty for anything but email"
}

RULES FOR THE TEXT INSIDE THOSE FIELDS

1. Emphasis uses exactly four markers and nothing else:
   **bold**   *italic*   ~~strikethrough~~   `monospace`
   These are a transport, not the output. They are converted to whatever each
   destination actually supports before anyone sees them, so do not add
   asterisks by hand for visual effect and do not write HTML.

2. NO hashtags inside headline, body, bullets or the call to action. They go in
   the hashtags array, once, without the # symbol. A tag written into a
   paragraph is published twice.

3. No markdown headings, no numbered "1." prefixes on bullets, no horizontal
   rules, no tables. Structure is the fields, not punctuation.

4. Write real specifics. A date, an amount, a section number, a place, a
   deadline. "Boost your business with our solutions" is the failure mode this
   contract exists to prevent — if you do not have a fact, say something
   smaller and true rather than something large and generic.

5. Indian context is the default: rupees as Rs. or the rupee sign, Indian date
   order, GST/TDS/MCA terminology used correctly, city names spelled as locals
   spell them.

6. If the language asked for is not English, write EVERY field in that
   language, including the call to action. Hashtags may stay in English where
   that is what people actually search.
""".strip()


def _limit_note(dest_keys: list[str]) -> str:
    limits = [(DESTINATIONS[k].label or k, DESTINATIONS[k].limit)
              for k in dest_keys if DESTINATIONS[k].limit]
    if not limits:
        return ""
    label, tightest = min(limits, key=lambda pair: pair[1])
    return (
        f"The tightest surface is {label} at {tightest} characters, so the whole "
        f"piece must fit inside that. Longer surfaces are filled by writing "
        f"well, not by padding."
    )


def destination_brief(destinations: Optional[Iterable[str]] = None) -> str:
    """What the model needs to know about where this is going.

    It is told the budget and whether tags exist there — nothing about syntax.
    Syntax is `rich_content`'s job, and a model told "LinkedIn has no markdown"
    starts hand-rolling Unicode bold characters into the JSON, which is the
    accessibility problem in §2 of that module arriving through the front door.
    """
    keys = [resolve_destination(d).key for d in (destinations or [])]
    keys = [k for k in dict.fromkeys(keys)]
    if not keys:
        return ""

    labels = [DESTINATIONS[k].label or k for k in keys]
    lines = [f"This will be published to: {', '.join(labels)}."]
    note = _limit_note(keys)
    if note:
        lines.append(note)
    if not any(DESTINATIONS[k].hashtag_cap for k in keys):
        lines.append(
            "None of these surfaces use hashtags. Return an empty hashtags array."
        )
    else:
        cap = max(DESTINATIONS[k].hashtag_cap for k in keys)
        lines.append(
            f"At most {cap} hashtags, each one a term a customer would actually "
            f"search. Tag walls are ignored by every ranker here."
        )
    if "instagram" in keys:
        lines.append(
            "Instagram shows only the first 125 characters before the More link, "
            "so the headline has to survive being read alone."
        )
    if "email" in keys:
        lines.append(
            "For email the headline IS the subject line: under 60 characters, no "
            "clickbait, and it must say what the mail is about."
        )
    if "google_ads" in keys:
        # `_limit_note` cannot state this one: the Ads editor caps each FIELD
        # rather than the piece, so the destination carries limit 0 and the
        # budget the model has to write to lives here instead.
        lines.append(
            "Google Ads caps every field separately: 30 characters for a "
            "headline and 90 for a description. The headline must work at 30, "
            "and each bullet is a description that must work at 90."
        )
    return "\n".join(lines)


def register_brief(
    content_type: Optional[str] = None,
    register: Optional[str] = None,
    emoji: Optional[bool] = None,
) -> str:
    """The emoji register, stated in the prompt exactly as it is enforced.

    `rich_content.policy_for` is the source of both this sentence and the
    ceiling applied to the output, so the two cannot drift into a rule the
    prompt describes and the renderer does not — which is how "Include relevant
    emojis naturally" ended up on a business proposal and a statutory notice
    from the same file.
    """
    policy = policy_for(content_type, register, emoji)
    return f"EMOJI: {policy.brief}"


def system_suffix(
    *,
    content_type: Optional[str] = None,
    register: Optional[str] = None,
    emoji: Optional[bool] = None,
    destinations: Optional[Iterable[str]] = None,
    language: str = "en",
    language_name: str = "",
) -> str:
    """Appended to whatever brand system prompt the caller already built.

    A suffix rather than a replacement: `_build_system_prompt` assembles the
    brand voice, the dos and the don'ts from `hub_brand_profiles`, and that is
    the customer's own configuration. This adds the shape, the register and the
    destination facts on top of it.
    """
    parts = [
        "You write for an Indian professional-services firm. Your output is "
        "published to its customers, so it is checked before it is admired: "
        "correct, specific, and free of the generic marketing register that "
        "makes a firm look like everyone else.",
        register_brief(content_type, register, emoji),
    ]
    dest = destination_brief(destinations)
    if dest:
        parts.append(dest)
    if language and language != "en":
        target = language_name or language
        parts.append(
            f"Write every field in {target}. Do not translate afterwards — "
            f"compose in it, so idiom and honorifics are right."
        )
    parts.append(RICH_DOC_CONTRACT)
    return "\n\n".join(p for p in parts if p)


# ── Per-agent task prompts ───────────────────────────────────────────────────
#
# Same keys and same `{platform}` / `{brief}` / `{extra}` placeholders as
# `routers/hub.py` AGENT_PROMPTS, so this is a substitution at the call site
# rather than a change to the request body. NOTHING here may contain another
# brace: the caller runs `.format()` over it.
#
# Each one now says what to put in the FIELDS, because "Output in structured
# markdown" is an instruction about punctuation and the model answered it
# literally — with headings a plain-text destination renders as hash symbols.

AGENT_PROMPTS: dict[str, str] = {
    "social_media": (
        "Write a social post for {platform}. Brief: {brief}. {extra}"
        "The headline is the scroll-stopper and must carry a fact, not a "
        "promise. Body is two or three short paragraphs. Bullets only if the "
        "subject genuinely has parts. The call to action names one next step."
    ),
    "blog": (
        "Write a blog article. Brief: {brief}. {extra}"
        "The headline is the article title. Body carries the full argument, one "
        "paragraph per array entry, six to twelve of them, opening with why "
        "this matters to an Indian firm right now and closing on what changes "
        "if they act. Bullets hold the checklist or the numbered comparison the "
        "argument needs."
    ),
    "ad_copy": (
        "Write advertising copy for {platform}. Brief: {brief}. {extra}"
        "The headline is the ad headline and must work at a glance. Body is one "
        "or two tight paragraphs of primary text. Bullets are the proof points. "
        "The call to action is the button text plus the reason to press it."
    ),
    "email": (
        "Write a marketing email. Brief: {brief}. {extra}"
        "The headline is the subject line, under 60 characters. Preview is the "
        "inbox preheader and must add to the subject rather than repeat it. Body "
        "is the mail itself, greeting through sign-off. The call to action is a "
        "single ask."
    ),
    "whatsapp": (
        "Write a WhatsApp business message. Brief: {brief}. {extra}"
        "Short, direct and personal: this arrives between a reader's family "
        "messages. Headline is one line, body is at most two short paragraphs, "
        "bullets only for a list of dates or documents. No hashtags."
    ),
    "lead_magnet": (
        "Write a lead magnet. Brief: {brief}. {extra}"
        "It must be worth the email address it costs. Body carries the actual "
        "method, step by step, with the numbers and thresholds a reader needs. "
        "Bullets are the checklist they will keep. The call to action offers the "
        "next thing, not a sales call."
    ),
    "campaign": (
        "Plan a marketing campaign. Brief: {brief}. {extra}"
        "Headline is the campaign line. Body covers objective, audience "
        "segments, the message per channel, and a two-week sequence with dates. "
        "Bullets are the KPIs with target numbers. The call to action is the "
        "first thing the firm does on day one."
    ),
    "seo": (
        "Write SEO content. Brief: {brief}. {extra}"
        "Headline is the meta title, under 60 characters. Preview is the meta "
        "description, under 155. Body is the full article, at least twelve "
        "paragraphs, with the primary term used where it reads naturally and "
        "never stuffed. Bullets are the FAQ questions, phrased the way somebody "
        "types them into search."
    ),
    "ad_analysis": (
        "Analyse the ad performance data supplied. Brief: {brief}. {extra}"
        "Headline states the single finding that matters. Body explains what "
        "moved and why, naming campaigns and figures from the data and nothing "
        "invented. Bullets are the recommended reallocations, each with the "
        "amount and the expected effect. The call to action is the change to "
        "make this week."
    ),
}


def build_content_prompt(
    agent_type: str,
    brief: str,
    *,
    platform: str = "",
    extra: str = "",
) -> str:
    """The user prompt for one agent type, with the contract already appended.

    Substitution happens here rather than at the call site so the contract — a
    solid block of literal JSON braces — never reaches `str.format()`. Unknown
    agent types fall back to the social template instead of raising: the caller
    validates `agent_type` against its own dict before spending a credit, and a
    second, different refusal here would only fire when the two dicts had
    already drifted.
    """
    template = AGENT_PROMPTS.get(agent_type) or AGENT_PROMPTS["social_media"]
    task = template.format(
        platform=platform or "general",
        brief=brief,
        extra=f"{extra}\n" if extra else "",
    )
    return f"{task}\n\n{RICH_DOC_CONTRACT}"


# ── Quick Generate ───────────────────────────────────────────────────────────
#
# Same keys, same `agent_type` mapping and the same `{topic}` / `{platform}` /
# `{tone}` / `{language}` / `{extra}` placeholders as
# `routers/hub.py` QUICK_SKILL_PROMPTS, so `quick_generate` keeps working with
# the skill names its Generate tab already sends. `credits` is deliberately
# absent, as it is in the current dict: the receipt names the price and a second
# copy of the number is how four of the seven skills came to disagree with the
# ledger.
#
# `register` is the new key. It is what makes a Diwali greeting and a GST
# deadline different pieces of writing rather than the same one with a
# different topic.

QUICK_SKILL_PROMPTS: dict[str, dict] = {
    "social_post": {
        "agent_type": "social_media",
        "register": "conversational",
        "system": (
            "You are a social media writer for an Indian business. You are "
            "writing one post that will be published to several networks at "
            "once, so write the substance and let the formatter handle each "
            "network's syntax."
        ),
        "prompt": (
            "Write a {platform} post about: {topic}\n"
            "Tone: {tone}\n"
            "Language: {language}\n"
            "{extra}"
        ),
    },
    "email_campaign": {
        "agent_type": "email",
        "register": "professional",
        "system": (
            "You are a marketing email writer for an Indian business. The "
            "subject line earns the open and the first paragraph earns the "
            "scroll; everything after that has to be worth the reader's time."
        ),
        "prompt": (
            "Write a marketing email about: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}"
        ),
    },
    "ad_copy": {
        "agent_type": "ad_copy",
        "register": "conversational",
        "system": (
            "You are an advertising copywriter for the Indian market. Every "
            "claim must be one the firm could defend if a customer asked."
        ),
        "prompt": (
            "Write {platform} ad copy about: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}"
        ),
    },
    "blog_post": {
        "agent_type": "blog",
        "register": "professional",
        "system": (
            "You are a content writer for an Indian business. Write for a "
            "reader who already knows the basics and wants the part they cannot "
            "get from the first search result."
        ),
        "prompt": (
            "Write a blog post about: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}"
        ),
    },
    "whatsapp_broadcast": {
        "agent_type": "whatsapp",
        "register": "conversational",
        "system": (
            "You are writing a WhatsApp broadcast for an Indian business. This "
            "lands in a personal inbox next to a reader's family messages, so "
            "it is short, it is useful, and it never sounds like a mailshot."
        ),
        "prompt": (
            "Write a WhatsApp broadcast about: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}"
        ),
    },
    "proposal": {
        "agent_type": "lead_magnet",
        "register": "professional",
        "system": (
            "You are writing a business proposal for an Indian company. Scope, "
            "deliverables, timeline and price stated plainly; the bullets are "
            "the deliverables, and the call to action is the next step in the "
            "engagement."
        ),
        "prompt": (
            "Write a business proposal for: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}"
        ),
    },
    "festival_campaign": {
        "agent_type": "campaign",
        "register": "festive",
        "system": (
            "You are writing an Indian festival campaign. Get the occasion "
            "right — the greeting, the regional name, what is actually being "
            "celebrated — and keep the commercial offer secondary to it."
        ),
        "prompt": (
            "Plan a festival campaign for: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}"
        ),
    },
    "compliance_alert": {
        # New, and the reason the register exists. A firm's most-forwarded post
        # is a due date, and it is the one piece of writing where an emoji makes
        # it look like a phishing message.
        "agent_type": "social_media",
        "register": "statutory",
        "system": (
            "You are writing a statutory deadline notice for an Indian "
            "professional-services firm. State the return or filing, the exact "
            "due date, who it applies to and the consequence of missing it. No "
            "persuasion, no ornament — this is a public service the firm's name "
            "is on."
        ),
        "prompt": (
            "Write a compliance deadline notice about: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}"
        ),
    },
}


def build_quick_prompt(
    skill: str,
    *,
    topic: str,
    platform: str = "",
    tone: str = "Professional",
    language: str = "en",
    language_name: str = "",
    extra: str = "",
    emoji: Optional[bool] = None,
) -> tuple[str, str]:
    """(system, prompt) for one Quick Generate skill.

    Returns both halves because the register belongs in the system half — it is
    a standing rule about the piece, not part of the request — while the topic
    belongs in the user half where the model treats it as the thing to write
    about rather than as an instruction.
    """
    cfg = QUICK_SKILL_PROMPTS.get(skill)
    if not cfg:
        raise KeyError(skill)

    system = cfg["system"] + "\n\n" + system_suffix(
        content_type=skill,
        register=cfg.get("register"),
        emoji=emoji,
        destinations=[platform] if platform else None,
        language=language,
        language_name=language_name,
    )
    prompt = cfg["prompt"].format(
        topic=topic,
        platform=platform or "general",
        tone=tone,
        language=language_name or language,
        extra=f"{extra}\n" if extra else "",
    )
    return system, prompt


def register_for_skill(skill: str) -> str:
    """The register a Quick Generate skill writes in.

    Reads the skill's own declaration first and falls back to the content-type
    map, so a skill added here without a `register` key still gets a considered
    default instead of the most permissive one.
    """
    cfg = QUICK_SKILL_PROMPTS.get(skill) or {}
    name = cfg.get("register")
    if name in REGISTERS:
        return name
    return register_for(cfg.get("agent_type") or skill)
