"""Rich content that survives the destination it is published to.

Owner, 2026-08-19: "content should full rich content not just markdown ... with
emoticon, or bold italic etc etc full rich ui".

The product's answer to that today is a prompt that says "Use markdown
formatting: **bold** for emphasis" (`routers/hub.py` QUICK_SKILL_PROMPTS
["social_post"]["system"]) and a publisher that posts the result verbatim into
`shareCommentary.text` — a plain-text LinkedIn field. So the emphasis arrives as
asterisks. The same body goes to Instagram, which renders nothing, and to
WhatsApp, where `*` already means bold and `**word**` posts as a bold asterisk.

These tests pin the shape that fixes it: one document, rendered per
destination. Each one is named for the thing that was going out wrong.
"""

import pytest

from services import rich_content as rc


#: The Mathematical Alphanumeric Symbols block. Anything in it is a Unicode
#: emphasis character, not a styled letter — see the accessibility warning in
#: §2 of `services/rich_content.py`.
def _has_math_alphanumerics(text: str) -> bool:
    return any(0x1D400 <= ord(ch) <= 0x1D7FF for ch in text)


@pytest.fixture
def doc() -> rc.RichDoc:
    return rc.RichDoc(
        headline="GSTR-3B for July is due on **20 August**",
        body=[
            "Late filing carries interest at 18% a year plus a *late fee* per day.",
            "We file for 40+ firms in Ahmedabad.",
        ],
        bullets=["Reconcile 2B against the purchase register", "Clear RCM first"],
        call_to_action="Send your July data by 14 August.",
        hashtags=["GST", "GSTR3B", "Compliance", "Ahmedabad"],
    )


# ── 1 · Each destination gets its own syntax ─────────────────────────────────

def test_linkedin_never_receives_a_markdown_asterisk(doc):
    """`publish_to_linkedin` posts into a plain-text field. An asterisk that
    reaches it is an asterisk the customer's followers read."""
    out = rc.render(doc, "linkedin")
    assert "**" not in out
    assert "*late fee*" not in out
    assert "𝟮𝟬 𝗔𝘂𝗴𝘂𝘀𝘁" in out, "LinkedIn's only emphasis mechanism was not used"


def test_whatsapp_uses_whatsapp_syntax_not_markdown(doc):
    """WhatsApp reads `*` as bold and `_` as italic. Markdown's doubled
    asterisks post as a literal bold asterisk."""
    out = rc.render(doc, "whatsapp")
    assert "**" not in out
    assert "*20 August*" in out
    assert "_late fee_" in out
    assert not _has_math_alphanumerics(out), \
        "WhatsApp has real emphasis; the Unicode mapper must not be reached"


def test_instagram_carries_no_formatting_at_all(doc):
    """Instagram captions render nothing. Emoji, line breaks and tags are the
    only structure available, so markers must be stripped rather than emitted."""
    out = rc.render(doc, "instagram")
    assert "*" not in out
    assert "_" not in out
    assert not _has_math_alphanumerics(out)
    assert "20 August" in out and "late fee" in out


def test_email_gets_real_html_and_the_in_app_editor_gets_real_markdown(doc):
    email = rc.render(doc, "email")
    assert "<strong>20 August</strong>" in email
    assert "<em>late fee</em>" in email
    assert "<ul><li>" in email

    editor = rc.render(doc, "markdown")
    assert "**20 August**" in editor
    assert "- Reconcile" in editor


#: Everything `sendMessage(parse_mode="HTML")` accepts. Anything else is
#: answered with 400 "can't parse entities: Unsupported start tag" and the
#: message is not delivered at all.
TELEGRAM_TAGS = {
    "b", "strong", "i", "em", "u", "ins", "s", "strike", "del",
    "span", "tg-emoji", "a", "code", "pre", "blockquote",
}


def _tags_in(text: str) -> set[str]:
    import re
    return set(re.findall(r"</?([a-z0-9-]+)", text))


def test_telegram_gets_only_the_tags_its_parse_mode_accepts(doc):
    """Telegram is HTML for a bold WORD and not HTML for a document: it has no
    `<h2>`, `<p>` or `<ul>`, and it rejects the whole message on the first one
    rather than dropping the tag. Rendered as a document, every Telegram
    publish 400s — worse than the raw markdown it replaced, which at least
    posted."""
    out = rc.render(doc, "telegram")
    assert _tags_in(out) <= TELEGRAM_TAGS
    assert "<strong>20 August</strong>" in out, "inline emphasis is what it does support"
    assert "• Reconcile" in out, "the list is carried by a bullet character, not by <ul>"


def test_telegram_is_held_to_the_limit_it_declares():
    """`sendMessage` rejects over 4,096 as well. The document renderer never
    called `_fit`, so a 5,000-character body was sent at 5,045."""
    long_doc = rc.RichDoc(body=["**" + "word " * 1500 + "**"])
    out = rc.render(long_doc, "telegram")
    assert len(out) <= rc.DESTINATIONS["telegram"].limit
    assert out.count("<strong>") == out.count("</strong>"), \
        "a cut between a tag and its closer is also a 400, and loses the whole post"
    import re
    assert not re.search(r"<[^>]*$", out), "half a tag left by the cut"


def test_one_document_produces_three_different_posts(doc):
    """The point of the module: structure once, render per platform. Three
    identical strings would mean somebody had gone back to pasting markdown."""
    rendered = rc.render_all(doc, ["linkedin", "whatsapp", "instagram"])
    assert len(set(rendered.values())) == 3
    for text in rendered.values():
        assert "20 August" in rc.plain_text(text) or "𝟮𝟬" in text


# ── 2 · Unicode emphasis is quarantined ──────────────────────────────────────

@pytest.mark.parametrize("destination", ["markdown", "email", "reddit", "telegram", "instagram", "whatsapp", "x"])
def test_only_linkedin_may_use_unicode_emphasis(doc, destination):
    """Mathematical alphanumerics are read letter-by-letter by screen readers
    and are not indexed by search. They are a last resort for a plain-text
    field, never a house style — so every destination with a real emphasis
    mechanism, and every destination with none at all, must be clean."""
    assert not _has_math_alphanumerics(rc.render(doc, destination))


def test_an_italic_run_containing_a_numeral_is_not_half_styled():
    """Unicode has sans-serif bold digits but no sans-serif italic ones, so
    `*14th*` would render as an upright "14" beside a slanted "th" — a font
    fault, not emphasis. And the runs this catches are dates and amounts."""
    doc = rc.RichDoc(headline="due on the *14th*", body=["a *late fee* applies"])
    out = rc.render(doc, "linkedin")
    assert "14th" in out, "the numeral run must stay plain rather than split"
    assert "𝘭𝘢𝘵𝘦 𝘧𝘦𝘦" in out, "a run without numerals still gets italic"


def test_a_bold_italic_run_with_a_numeral_falls_back_to_bold():
    doc = rc.RichDoc(headline="***Rs. 50 per day***")
    assert "𝗥𝘀. 𝟱𝟬 𝗽𝗲𝗿 𝗱𝗮𝘆" in rc.render(doc, "linkedin")


def test_the_unicode_tables_contain_nothing_but_ascii_letters_and_digits():
    """The Devanagari guarantee is the table, not a check somewhere.
    `str.translate` leaves every key it does not hold alone, so a table with
    only ASCII keys physically cannot touch Hindi."""
    for table in (rc._BOLD_TABLE, rc._ITALIC_TABLE, rc._BOLD_ITALIC_TABLE):
        assert all(key < 128 for key in table)
        assert all(chr(key).isascii() and chr(key).isalnum() for key in table)


# ── 3 · Devanagari must survive every transform ──────────────────────────────

HINDI = "जीएसटी रिटर्न की अंतिम तिथि"


def test_unicode_bold_leaves_devanagari_exactly_as_it_was():
    """`'क'.isalpha()` is True, so the obvious mapper — offset from `ord('a')`
    for anything alphabetic — lands Hindi in the middle of an unrelated block
    and detaches its matras. Nothing in Unicode encodes bold Devanagari; weight
    there is a font property, and passthrough is the only correct answer."""
    assert rc.to_unicode_bold(HINDI) == HINDI
    assert rc.to_unicode_italic(HINDI) == HINDI
    assert rc.to_unicode_bold_italic(HINDI) == HINDI


def test_the_mapper_itself_substitutes_only_what_its_tables_hold():
    """The table-level half of the guarantee: `str.translate` leaves every key
    it does not hold alone, so the Hindi in a mixed string is untouched while
    the ASCII around it is mapped. That is correct for the MAPPER — what a run
    is allowed to do with it is decided one level up, by the test below."""
    out = rc.to_unicode_bold(f"{HINDI} GSTR-3B 2026")
    assert out.startswith(HINDI)
    assert "𝗚𝗦𝗧𝗥" in out and "𝟮𝟬𝟮𝟲" in out


def test_a_run_that_mixes_scripts_is_not_half_styled():
    """`**GST रिटर्न 2026**` rendered as heavy sans-serif around a
    regular-weight रिटर्न — two visible weights inside one phrase. The module
    already refuses exactly that for digits, on the grounds that it "reads as a
    font fault rather than as emphasis", and a mixed run is the far commoner
    case here: this product ships six languages and GST, TDS, ITR and MCA are
    always written in Latin inside Hindi, Gujarati and Marathi prose."""
    assert rc._line(f"**GST {HINDI} 2026**", rc.EMPHASIS_UNICODE) == f"GST {HINDI} 2026"
    assert rc._line(f"*{HINDI}*", rc.EMPHASIS_UNICODE) == HINDI
    # Devanagari numerals are the same fault with `.isalpha()` False.
    assert rc._line("**२०२६ deadline**", rc.EMPHASIS_UNICODE) == "२०२६ deadline"


def test_a_run_that_is_entirely_latin_still_gets_its_emphasis():
    """The guard is per RUN, not per line: a bold English term inside a Hindi
    sentence is legitimate emphasis and must survive, or the rule above would
    cost every bilingual post its headline weight."""
    out = rc._line(f"**GST** {HINDI}", rc.EMPHASIS_UNICODE)
    assert out == f"𝗚𝗦𝗧 {HINDI}"


@pytest.mark.parametrize("destination", sorted(rc.DESTINATIONS))
def test_every_destination_ships_hindi_intact(destination):
    """A renderer that drops or reorders a matra produces a word no reader
    recognises, and it does it silently."""
    doc = rc.RichDoc(
        headline=f"**{HINDI}**",
        body=[f"आपकी फ़र्म के लिए *{HINDI}* 20 अगस्त है।"],
        bullets=["२बी मिलान करें"],
        call_to_action="आज ही भेजें।",
    )
    out = rc.render(doc, destination)
    assert HINDI in out
    assert "२बी मिलान करें" in out
    assert "20 अगस्त" in out


def test_a_devanagari_hashtag_is_not_erased():
    """`#दिवाली` is a working tag on every platform here. A character class of
    `[^0-9A-Za-z_]` would strip it to the empty string and the tag would vanish
    without anything saying so."""
    assert rc.normalise_hashtag("#दिवाली") == "दिवाली"
    assert rc.normalise_hashtag("#GST Filing") == "GSTFiling"
    assert rc.normalise_hashtag("#") == ""


# ── 4 · Hashtags: the ## bug ─────────────────────────────────────────────────

def test_tags_are_stored_bare_so_the_publisher_cannot_double_the_hash():
    """`re.findall(r'#\\w+', ...)` at hub.py:752 keeps the `#`, and
    social_publisher.py:690 then formats each stored tag as `f"#{h}"` — so
    every published post carried `##GST`. The tag leaves the parser bare and
    the renderer is the only thing that adds a hash."""
    doc = rc.from_model_output('{"headline": "x", "hashtags": ["#GST", "GSTR3B"]}')
    assert doc.hashtags == ["GST", "GSTR3B"]
    assert "##" not in rc.render(doc, "instagram")


def test_tags_written_into_the_prose_are_lifted_out_rather_than_published_twice():
    """The other half of the same bug: the model wrote the tags into the body
    AND the regex copied them into the column, so the publisher appended a
    second copy under the first."""
    doc = rc.from_model_output(
        "GST deadline\n\nFile before 20 August. #GST #Compliance"
    )
    assert {t.casefold() for t in doc.hashtags} == {"gst", "compliance"}
    out = rc.render(doc, "instagram")
    assert out.count("#GST") == 1
    assert out.count("#Compliance") == 1


def test_each_destination_carries_the_tag_count_that_belongs_there(doc):
    assert rc.render(doc, "whatsapp").count("#") == 0, "hashtags are not a WhatsApp thing"
    assert rc.render(doc, "linkedin").count("#") == 3
    assert rc.render(doc, "instagram").count("#") == 4
    assert rc.render(doc, "email").count("#") == 0


# ── 5 · Emoji is a register, not a sprinkle ──────────────────────────────────

FESTIVE = rc.RichDoc(
    headline="Happy Diwali 🪔",
    body=["Wishing you a bright year ✨🎉🎊"],
    bullets=["🎁 Books closed on time", "📊 Returns filed"],
    call_to_action="Talk to us 💯🚀🔥",
)


def test_a_statutory_notice_ships_no_emoji_at_all():
    """A due date with a rocket on it reads as a phishing message. The register
    is a property of the content type, and `compliance` has none."""
    out = rc.render(FESTIVE, "linkedin", content_type="compliance")
    assert rc.count_emoji(out) == 0
    assert "Happy Diwali" in out


def test_a_festival_greeting_keeps_its_warmth():
    out = rc.render(FESTIVE, "instagram", content_type="festival_greeting")
    assert rc.count_emoji(out) >= 6


def test_emoji_can_be_turned_off_even_on_a_festive_register():
    """The off switch is absolute. A firm that says no emoji means it for the
    Diwali post too — folding the preference into a register would re-enable it
    the moment somebody retagged the content type."""
    out = rc.render(FESTIVE, "instagram", content_type="festival_greeting", emoji=False)
    assert rc.count_emoji(out) == 0


def test_the_ceiling_keeps_the_working_emoji_and_drops_the_pile_up():
    """Over the ceiling, the bullet leaders are paid first: an emoji that opens
    a list item IS the bullet, while the `💯🚀🔥` trailing the call to action is
    the decoration a post overruns on. Keeping simply the first N would let
    three ornaments in the opening paragraph starve every bullet in the list."""
    out = rc.render(FESTIVE, "instagram", content_type="blog")   # professional: 2
    assert rc.count_emoji(out) == 2
    assert "🎁" in out and "📊" in out
    assert "🚀" not in out and "🔥" not in out


def test_the_professional_register_keeps_the_headline_clean():
    out = rc.render(FESTIVE, "instagram", content_type="blog")
    assert out.splitlines()[0] == "Happy Diwali"


def test_the_renderer_never_invents_an_emoji():
    """Judgement about which emoji belongs is the model's, under a briefed
    register. A bullet leader chosen from a lookup table is exactly the
    sprinkling that was complained about."""
    plain = rc.RichDoc(headline="Quarter closed", bullets=["a", "b"], call_to_action="Call us")
    for destination in ("instagram", "whatsapp", "linkedin", "markdown"):
        assert rc.count_emoji(rc.render(plain, destination, content_type="festival_greeting")) == 0


@pytest.mark.parametrize(
    "text,expected",
    [
        ("👩‍💻", 1),        # ZWJ sequence: one glyph, two base characters
        ("🇮🇳", 1),          # flag: a pair of regional indicators
        ("1️⃣", 1),          # keycap: an ASCII digit plus two combiners
        ("👍🏽", 1),          # skin-tone modifier
        ("🪔✨", 2),
    ],
)
def test_an_emoji_is_counted_as_one_glyph_not_as_its_codepoints(text, expected):
    assert rc.count_emoji(text) == expected
    assert rc.strip_emoji(f"a {text} b") == "a b"


def test_trademarks_and_arrows_are_business_text_not_ornament():
    """Stripping ® from a firm's brand name is a legal edit, and `→` is
    punctuation in a pricing line. Neither is decoration."""
    assert rc.count_emoji("Kartavya® — Rs. 999 → Rs. 799 ™ ©") == 0
    assert rc.strip_emoji("Kartavya® → Rs. 799") == "Kartavya® → Rs. 799"


def test_the_danda_is_not_mistaken_for_an_emoji():
    assert rc.count_emoji("यह वाक्य है। और यह भी ॥") == 0


# ── 6 · Length budgets ───────────────────────────────────────────────────────

def test_x_fits_in_its_280_characters(doc):
    out = rc.render(doc, "x")
    assert len(out) <= 280
    assert "GSTR-3B" in out
    assert "Send your July data" in out, "the call to action is what the post is for"


@pytest.mark.parametrize("destination", ["linkedin", "instagram", "x", "threads", "whatsapp"])
def test_no_destination_is_ever_overrun(destination):
    long_doc = rc.RichDoc(
        headline="Quarter close checklist",
        body=["Sentence number %d about reconciliation and filing." % i for i in range(60)],
        bullets=["Point %d" % i for i in range(30)],
        call_to_action="Call the office.",
        hashtags=["GST", "Audit", "Compliance"],
    )
    out = rc.render(long_doc, destination)
    assert len(out) <= rc.DESTINATIONS[destination].limit


def test_truncation_cuts_on_a_word_and_never_inside_an_emoji():
    """A space can never fall inside an emoji cluster, so cutting there cannot
    leave half a glyph — and half a glyph is a replacement box on a public
    post."""
    doc = rc.RichDoc(headline="🎉 " + "word " * 200 + "🪔 end")
    out = rc.render(doc, "x", content_type="festival_greeting")
    assert len(out) <= 280
    assert "�" not in out
    assert out.endswith("…")


# ── 7 · Parsing what the model actually returned ─────────────────────────────

def test_a_fenced_json_block_is_read_as_the_document():
    doc = rc.from_model_output(
        'Sure!\n```json\n{"headline": "H", "bullets": ["a"], "cta": "Go"}\n```\n'
    )
    assert doc.headline == "H"
    assert doc.bullets == ["a"]
    assert doc.call_to_action == "Go"


def test_a_prose_blob_still_produces_a_document_rather_than_an_exception():
    """`generate_content` refunds a provider exception, not a parse failure — so
    a raise here would keep the credit and return nothing. The old prose
    behaviour is the floor, not the target."""
    doc = rc.from_model_output(
        "# Quarter close\n\nBooks shut on 30 June.\n\n- Reconcile 2B\n- File GSTR-1\n\n#GST"
    )
    assert doc.headline == "Quarter close"
    assert doc.bullets == ["Reconcile 2B", "File GSTR-1"]
    assert doc.hashtags == ["GST"]
    assert not doc.is_empty()


def test_bullet_objects_are_accepted_because_models_return_them():
    doc = rc.from_model_output('{"headline": "H", "bullets": [{"text": "one"}, {"text": "two"}]}')
    assert doc.bullets == ["one", "two"]


def test_the_title_comes_from_the_headline_not_from_the_customers_prompt():
    """`hub_content_items.title` is `body.brief[:100]` today — the request,
    truncated. The headline is already in the response and is a better name."""
    doc = rc.from_model_output('{"headline": "**GSTR-3B** due 20 August", "body": ["x"]}')
    assert doc.title() == "GSTR-3B due 20 August"


def test_a_document_survives_a_round_trip_through_storage():
    """`to_dict` is what goes into `hub_content_items.metadata`, and the row is
    read back to re-render for a second platform without paying again. A round
    trip that nested `extras` inside itself would lose the meta description on
    the second read."""
    doc = rc.from_model_output(
        '{"headline": "H", "body": ["p"], "hashtags": ["#GST"], "keywords": ["gst"]}'
    )
    assert doc.extras == {"keywords": ["gst"]}
    again = rc.from_dict(doc.to_dict())
    assert again.to_dict() == doc.to_dict()


def test_an_empty_response_does_not_crash_the_renderers():
    doc = rc.from_model_output("")
    assert doc.is_empty()
    for destination in rc.DESTINATIONS:
        assert rc.render(doc, destination) == ""


# ── 8 · Destination resolution ───────────────────────────────────────────────

@pytest.mark.parametrize(
    "given,expected",
    [
        ("whatsapp_business", "whatsapp"),   # the value hub_social_accounts stores
        ("WhatsApp", "whatsapp"),
        ("Twitter", "x"),
        ("google-business", "google_business"),
        ("", "markdown"),
        ("Mastodon", "markdown"),            # free text a customer typed
    ],
)
def test_platform_strings_resolve_without_refusing_the_generation(given, expected):
    """`ContentGenerate.platform` is free text. Refusing over a spelling would
    take the credit and return an error; markdown is merely unformatted."""
    assert rc.resolve_destination(given).key == expected


#: Verbatim from `frontend/src/pages/sahayak/platformText.PLATFORMS`, which is
#: the list the Generate form renders and the exact strings it sends.
UI_PLATFORMS = {
    "Instagram": "instagram",
    "LinkedIn": "linkedin",
    "WhatsApp": "whatsapp",
    "Facebook": "facebook",
    "Twitter / X": "x",
    "Email": "email",
    "Google Ads": "google_ads",
    "Website": "website",
}


@pytest.mark.parametrize("label,expected", sorted(UI_PLATFORMS.items()))
def test_every_label_the_generate_form_sends_reaches_its_own_destination(label, expected):
    """Three of the eight carry a separator the alias table never held, and the
    fallback for an unknown platform is silent by design — so "Twitter / X"
    resolved to the in-app editor and a tweet was rendered as a markdown
    heading, with no tag block and no 280-character fit."""
    assert rc.resolve_destination(label).key == expected


def test_a_tweet_is_fitted_to_280_under_the_name_the_form_sends():
    doc = rc.RichDoc(
        headline="**GSTR-3B** due 20 August",
        body=["Sentence %d about reconciliation." % i for i in range(30)],
        call_to_action="Send July data by 14 August.",
        hashtags=["GST", "Compliance", "Ahmedabad"],
    )
    out = rc.render(doc, "Twitter / X")
    assert len(out) <= 280
    assert not out.startswith("##"), "a markdown heading published as two hash symbols"
    assert out.count("#") == 2, "X carries two tags, not the editor's none"


# ── 9 · Safety ───────────────────────────────────────────────────────────────

def test_html_output_escapes_the_text_it_wraps():
    """Escaped at the point the tag is added, the way `email_service.py` escapes
    at `_safe_subject` — one choke point, so a new field cannot forget."""
    doc = rc.RichDoc(headline="<script>alert(1)</script>", body=["a & b"])
    out = rc.render(doc, "email")
    assert "<script>" not in out
    assert "&lt;script&gt;" in out
    assert "a &amp; b" in out


def test_the_module_makes_no_network_call_and_needs_no_key():
    """A formatter that reached a provider would be billed per destination —
    the exact cost the "one document, many renders" shape exists to avoid."""
    import inspect
    source = inspect.getsource(rc)
    for forbidden in ("httpx", "requests", "openai", "API_KEY", "await "):
        assert forbidden not in source, f"rich_content should be pure; found {forbidden!r}"
