"""
prompt.py — one substitution for skill step prompts, in every brace dialect.

There were three, and they disagreed.

  · `run_skill` (per-client, routers/hub.py) replaced `{var}`
  · `run_org_skill` (per-org) replaced `{{var}}`
  · `skill_dispatcher._run_llm_step` called `str.format(**variables)`

The catalog holds both dialects — five of the six seeded templates are
single-brace, `Weekly Social Media Pack` is double — so each path filled only
the templates written in its own convention and passed the rest to the model
with the placeholders intact. The failure is silent and it bills: Campaign
Launch asked the user for a brief, then sent the model a literal
`{campaign_brief}` and charged 19 credits for it.

`.format()` was the worst of the three. It raises `KeyError` on any placeholder
the caller did not supply — so a template with an optional variable takes the
whole run down — and it treats `{{` as an escaped literal brace, turning
`{{brand_name}}` into the string `{brand_name}` no matter what was passed.

This module is the single answer. It lives under `services/` rather than in the
router because the dispatcher must not import from `routers/`.
"""


def fill_prompt(template: str, variables: dict) -> str:
    """Substitute `{var}` and `{{var}}` placeholders into a step prompt.

    Both dialects are accepted rather than migrating the template rows:
    templates are org data, customers author their own through Create Template,
    and rewriting today's six leaves the next hand-written `{{topic}}` broken
    exactly the same way.

    Doubles are replaced BEFORE singles. The other order matches the inner
    `{var}` of `{{var}}` and leaves the outer pair stranded as `{Acme}` — which
    is what the client path was already doing to the one double-brace template
    in the catalog.

    Unknown placeholders are left in the text rather than blanked. Deliberate: a
    visible `{topic_5}` in the output gets the template fixed, while a silent
    empty string produces a fluent, confident answer about nothing — the more
    expensive failure, and the harder one to notice.
    """
    if not template:
        return ""

    for key, value in (variables or {}).items():
        rendered = str(value)
        template = template.replace(f"{{{{{key}}}}}", rendered)
        template = template.replace(f"{{{key}}}", rendered)
    return template
