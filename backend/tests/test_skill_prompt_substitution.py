"""
Skill step placeholders — one substitution, both brace dialects.

The two run paths were written against different conventions and neither was
wrong on its own; together they were. `run_skill` (per-client) replaced `{var}`,
`run_org_skill` replaced `{{var}}`, and the seeded catalog holds BOTH — five
templates single-brace, `Weekly Social Media Pack` double. Each path therefore
filled only the templates written in its own dialect.

The failure is silent and it bills. A user opens Sahayak → Skills, is asked for a
campaign brief because the FRONTEND reads placeholders with a single-brace regex
(`pages/hub/skills/_shared.jsx:95`, so it agrees with neither path consistently),
types one, and the org path looks for `{{campaign_brief}}`, finds nothing, and
sends the model the literal string `{campaign_brief}`. 19 credits, spent on an
answer to a question nobody asked. Verified against the live catalog on
staging 2026-08-02.

These pin the helper, not the routes: the substitution is the part that was
wrong and it is now the one place both paths go through.
"""
import pytest

from services.skills.prompt import fill_prompt as _fill_prompt


# The two dialects, as they actually appear in staging.hub_skill_templates.
SINGLE = "Create a complete marketing campaign for: {campaign_brief}. Audience: {target_audience}."
DOUBLE = "Create a professional thought leadership post about industry trends for {{brand_name}}"


def test_single_braces_are_filled():
    """Five of the six seeded templates. Broken on the ORG path before this."""
    out = _fill_prompt(SINGLE, {"campaign_brief": "Diwali sale", "target_audience": "SMB owners"})

    assert out == "Create a complete marketing campaign for: Diwali sale. Audience: SMB owners."
    assert "{" not in out


def test_double_braces_are_filled():
    """`Weekly Social Media Pack`. Broken on the CLIENT path before this."""
    out = _fill_prompt(DOUBLE, {"brand_name": "Aekam"})

    assert out.endswith("for Aekam")
    assert "{" not in out


def test_double_braces_do_not_leave_stranded_braces():
    """
    The ordering bug, pinned.

    Replacing `{var}` first matches the INNER braces of `{{var}}` and leaves the
    outer pair behind as `{Aekam}` — which is exactly what the client path did
    to the one double-brace template in the catalog. Doubles must go first.
    """
    out = _fill_prompt("{{brand_name}}", {"brand_name": "Aekam"})

    assert out == "Aekam"
    assert out != "{Aekam}"


def test_both_dialects_in_one_template():
    """
    Nothing stops a hand-authored template from mixing them, and Create Template
    accepts any prompt text at all — the server validates `agent_type` and that
    the prompt is non-empty, never the braces.
    """
    out = _fill_prompt("{{greeting}}, welcome to {product}!", {"greeting": "Namaste", "product": "Kartavya"})

    assert out == "Namaste, welcome to Kartavya!"


def test_unknown_placeholders_are_left_alone():
    """
    A template asking for something the form never collected keeps its
    placeholder rather than collapsing to an empty string.

    Deliberate: `{topic_5}` reaching the model is visible in the output and
    someone fixes the template. Silently blanking it produces a fluent,
    confident answer about nothing, which is the more expensive failure.
    """
    out = _fill_prompt("Write about {topic_1} and {topic_2}.", {"topic_1": "GST filing"})

    assert out == "Write about GST filing and {topic_2}."


def test_values_are_coerced_not_assumed_to_be_strings():
    """`custom_config` is arbitrary JSON, so a step count or a flag arrives as
    an int or a bool and `str.replace` would raise on a non-str argument."""
    out = _fill_prompt("Produce {count} variants, urgent={urgent}.", {"count": 5, "urgent": True})

    assert out == "Produce 5 variants, urgent=True."


def test_no_variables_is_a_pass_through():
    """An unconfigured run must not mangle the template."""
    assert _fill_prompt(SINGLE, {}) == SINGLE


@pytest.mark.parametrize("template", [SINGLE, DOUBLE])
def test_every_seeded_dialect_is_fully_resolved(template):
    """
    The regression in one line: give the helper every variable a template names,
    in either dialect, and no placeholder survives.
    """
    out = _fill_prompt(template, {
        "campaign_brief": "x", "target_audience": "y", "brand_name": "z",
    })

    assert "{" not in out and "}" not in out
