"""Company logo as SVG — allowed, but never as ACTIVE content.

The owner asked for SVG on 2026-08-08. The upload screen had offered
`image/svg+xml` in its `accept` attribute since it was written, so the file
picker showed .svg files and the server then answered 415 — a format advertised
and refused.

An SVG is XML, not a bitmap. It can carry `<script>`, event handlers and
references that fetch on open. In an `<img>` none of it executes, and WeasyPrint
renders the PDF with `base_url=None` so it cannot resolve anything remote —
both of the paths this product actually renders a logo on are safe. What is NOT
safe is somebody opening the signed storage URL directly, where the browser
treats it as a document and runs what is inside.

A company logo needs none of these constructs, so the file is refused rather
than sanitised: rewriting hostile XML and hoping the rewrite was complete is a
much harder promise than declining it.
"""
from routers.uploads import ALLOWED_EXTENSIONS, ALLOWED_TYPES, _svg_is_safe


def test_svg_is_actually_allowed_now():
    assert "image/svg+xml" in ALLOWED_TYPES
    assert ".svg" in ALLOWED_EXTENSIONS


def test_an_ordinary_logo_passes():
    svg = (b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" '
           b'viewBox="0 0 100 40"><path d="M0 0h100v40H0z" fill="#05b7aa"/>'
           b'<text x="8" y="26">Aekam</text></svg>')
    assert _svg_is_safe(svg)


def test_a_script_tag_is_refused():
    assert not _svg_is_safe(b'<svg><script>fetch("//evil")</script></svg>')


def test_an_event_handler_is_refused_whatever_it_is_called():
    """There are ~70 of them, and a list would be missing whichever one somebody
    used. Matched by pattern instead."""
    for h in (b"onload", b"onclick", b"onmouseover", b"onfocus", b"onanimationend"):
        assert not _svg_is_safe(b"<svg " + h + b"=alert(1)></svg>"), h


def test_whitespace_around_the_equals_does_not_smuggle_a_handler():
    assert not _svg_is_safe(b"<svg onload = alert(1)></svg>")


def test_an_xml_entity_is_refused():
    """XXE — an entity that reads a local file off whatever parses it."""
    assert not _svg_is_safe(
        b'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>')


def test_embedded_html_and_remote_objects_are_refused():
    for bad in (b"<foreignObject>", b"<iframe src=x>", b"<embed src=x>",
                b"<object data=x>"):
        assert not _svg_is_safe(b"<svg>" + bad + b"</svg>"), bad


def test_a_javascript_url_is_refused():
    assert not _svg_is_safe(b'<svg><a href="javascript:alert(1)">x</a></svg>')


def test_the_check_is_case_insensitive():
    """`<SCRIPT>` and `<ScRiPt>` are the same tag to a browser."""
    assert not _svg_is_safe(b"<svg><SCRIPT>x</SCRIPT></svg>")
    assert not _svg_is_safe(b"<svg ONLOAD=x></svg>")


def test_a_plain_logo_with_style_and_gradients_still_passes():
    """The refusal must not catch ordinary design output. Illustrator and Figma
    both emit <style>, <defs> and gradients, and a logo that is refused for
    looking like a logo is worse than no SVG support at all."""
    svg = (b'<svg xmlns="http://www.w3.org/2000/svg"><defs>'
           b'<linearGradient id="g"><stop offset="0" stop-color="#05b7aa"/>'
           b'</linearGradient></defs><style>.a{fill:url(#g)}</style>'
           b'<circle class="a" cx="20" cy="20" r="18"/></svg>')
    assert _svg_is_safe(svg)
