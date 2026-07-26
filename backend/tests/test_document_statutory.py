"""Statutory correctness of every document this product generates.

Three groups:

1. `TestTaxInvoice` / `TestPayslip` — the refusal rules. Each asserts both that
   a complete document passes and that the specific gap blocks, because a
   validator that blocks everything is as useless as one that blocks nothing.
2. `TestIndianGrouping` — 2,2,3 digit grouping, which is a correctness property
   on an Indian document, not a style one.
3. `TestDevanagariFont` — reads the vendored font binary and asserts the
   codepoint repertoire and the OpenType features that Devanagari conjunct
   formation needs. A font swap that drops them fails here rather than on a
   customer's tax invoice.

These are pure-function tests: no DB, no WeasyPrint, no network.
"""

import re
import struct
from pathlib import Path

import pytest

from services.doc_fonts import (
    DEVANAGARI_FILE,
    deva_span,
    font_face_css,
    group_indian,
    has_devanagari_font,
)
from services.doc_validation import (
    DocumentIncomplete,
    validate_payslip,
    validate_tax_invoice,
)


# ── fixtures ─────────────────────────────────────────────────────────────────

def complete_org():
    return {
        "name": "Aekam Inc",
        "gstin": "27AAACA1234M1Z8",
        "pan": "AAACA1234M",
        "billing_address": {
            "line1": "Unit 402, Meridien Tower", "line2": "Bandra Kurla Complex",
            "city": "Mumbai", "state": "Maharashtra", "pincode": "400051", "country": "India",
        },
        "authorized_signatory_name": "Keval Shah",
        "authorized_signatory_designation": "Director",
    }


def complete_contact():
    return {"name": "Tata Steel Limited", "company": "Tata Steel Limited", "gstin": "27AAACT2727Q1ZW"}


def complete_invoice(**over):
    inv = {
        "invoice_type": "tax_invoice",
        "invoice_number": "INV-2607",
        "invoice_date": "2026-07-08",
        "place_of_supply": "Maharashtra (27)",
        "is_igst": False,
        "currency": "INR",
        "line_items": [
            {"description": "Office fit-out — Phase 2", "hsn_code": "995461",
             "quantity": 1, "rate": 325000, "gst_rate": 18, "line_total": 325000},
        ],
        "subtotal": 325000, "cgst": 29250, "sgst": 29250, "igst": 0,
        "total": 383500, "balance_due": 383500,
    }
    inv.update(over)
    return inv


def complete_employee(**over):
    emp = {
        "name": "Aanya Mehta", "employee_code": "KV-0042", "designation": "Manager — Finance",
        "pan": "BQZPM4417L", "uan": "101234567890", "esi_number": "3101234567",
    }
    emp.update(over)
    return emp


def complete_payslip(**over):
    ps = {
        "payslip_number": "PS-2607-004", "month": "2026-07",
        "gross": 145000.0, "total_deductions": 20300.0, "net_pay": 124700.0,
        "pf_employee": 8700.0, "esi_employee": 1088.0, "professional_tax": 200.0, "tds": 10312.0,
    }
    ps.update(over)
    return ps


def fields(check):
    return {g.field for g in check.blocking}


# ── tax invoice ──────────────────────────────────────────────────────────────

class TestTaxInvoice:
    def test_complete_invoice_passes(self):
        chk = validate_tax_invoice(complete_invoice(), complete_org(), complete_contact())
        assert chk.ok, f"unexpected blocking gaps: {fields(chk)}"

    def test_missing_supplier_gstin_blocks(self):
        """The defect this whole module exists for: an invoice with no supplier
        GSTIN previously rendered as if complete."""
        chk = validate_tax_invoice(complete_invoice(), {**complete_org(), "gstin": ""}, complete_contact())
        assert not chk.ok
        assert "org.gstin" in fields(chk)
        gap = next(g for g in chk.blocking if g.field == "org.gstin")
        assert "input tax credit" in gap.reason
        assert gap.fix  # the user is told where to fix it

    def test_missing_hsn_on_any_line_blocks(self):
        inv = complete_invoice(line_items=[
            {"description": "A", "hsn_code": "995461", "line_total": 1},
            {"description": "B", "line_total": 1},          # neither hsn nor sac
        ])
        chk = validate_tax_invoice(inv, complete_org(), complete_contact())
        assert "invoice.line_items.hsn_code" in fields(chk)
        gap = next(g for g in chk.blocking if g.field == "invoice.line_items.hsn_code")
        assert "Line 2" in gap.reason  # names which line, not just "a line"

    def test_sac_code_satisfies_hsn_requirement(self):
        inv = complete_invoice(line_items=[{"description": "Service", "sac_code": "998399", "line_total": 1}])
        chk = validate_tax_invoice(inv, complete_org(), complete_contact())
        assert chk.ok, fields(chk)

    def test_igst_with_cgst_sgst_blocks(self):
        inv = complete_invoice(is_igst=True, igst=58500, cgst=29250, sgst=29250,
                               place_of_supply="Karnataka (29)")
        chk = validate_tax_invoice(inv, complete_org(), complete_contact())
        assert "invoice.tax_split" in fields(chk)

    def test_intrastate_with_igst_blocks(self):
        inv = complete_invoice(is_igst=False, igst=58500)
        chk = validate_tax_invoice(inv, complete_org(), complete_contact())
        assert "invoice.tax_split" in fields(chk)

    def test_place_of_supply_blocks_only_when_interstate(self):
        """Rule 46(n) scopes the requirement to inter-State supply. A blanket
        rule would 422 every historical intra-state invoice, whose column
        defaults to ''."""
        inter = complete_invoice(is_igst=True, igst=58500, cgst=0, sgst=0, place_of_supply="")
        assert "invoice.place_of_supply" in fields(validate_tax_invoice(inter, complete_org(), complete_contact()))

        intra = complete_invoice(place_of_supply="")
        chk = validate_tax_invoice(intra, complete_org(), complete_contact())
        assert chk.ok
        assert "invoice.place_of_supply" in {g.field for g in chk.advisory}

    def test_recipient_gstin_is_advisory_not_blocking(self):
        """A B2C supply to an unregistered buyer legitimately has none."""
        chk = validate_tax_invoice(complete_invoice(), complete_org(), {"name": "Walk-in buyer"})
        assert chk.ok, fields(chk)
        assert "contact.gstin" in {g.field for g in chk.advisory}

    def test_quotation_without_gstin_is_fine(self):
        """A quotation is an offer, not a tax document."""
        inv = complete_invoice(invoice_type="quotation", line_items=[{"description": "X", "line_total": 1}])
        chk = validate_tax_invoice(inv, {**complete_org(), "gstin": ""}, complete_contact())
        assert chk.ok, fields(chk)

    def test_proforma_without_hsn_is_fine(self):
        inv = complete_invoice(invoice_type="proforma", line_items=[{"description": "X", "line_total": 1}])
        chk = validate_tax_invoice(inv, complete_org(), complete_contact())
        assert chk.ok, fields(chk)

    def test_export_invoice_still_needs_supplier_gstin(self):
        inv = complete_invoice(is_export=True, currency="USD")
        chk = validate_tax_invoice(inv, {**complete_org(), "gstin": ""}, complete_contact())
        assert "org.gstin" in fields(chk)

    def test_no_line_items_blocks(self):
        chk = validate_tax_invoice(complete_invoice(line_items=[]), complete_org(), complete_contact())
        assert "invoice.line_items" in fields(chk)

    def test_missing_number_or_date_blocks(self):
        assert "invoice.invoice_number" in fields(
            validate_tax_invoice(complete_invoice(invoice_number=""), complete_org(), complete_contact()))
        assert "invoice.invoice_date" in fields(
            validate_tax_invoice(complete_invoice(invoice_date=None), complete_org(), complete_contact()))

    def test_payload_names_every_gap_and_invents_nothing(self):
        chk = validate_tax_invoice(complete_invoice(line_items=[{"description": "X", "line_total": 1}]),
                                   {**complete_org(), "gstin": ""}, complete_contact())
        with pytest.raises(DocumentIncomplete) as exc:
            chk.raise_if_incomplete()
        payload = exc.value.as_payload()
        assert payload["error"] == "document_incomplete"
        assert payload["document"] == "tax invoice"
        assert {g["field"] for g in payload["blocking"]} >= {"org.gstin", "invoice.line_items.hsn_code"}
        assert "invented" in payload["message"]

    def test_generator_refuses_before_importing_weasyprint(self):
        """The refusal must not depend on WeasyPrint being installed — the check
        runs first, so it works in CI and in a container without the native
        stack."""
        from services.invoice_pdf import generate_invoice_pdf
        with pytest.raises(DocumentIncomplete):
            generate_invoice_pdf(complete_invoice(), {**complete_org(), "gstin": ""}, complete_contact())


# ── payslip ──────────────────────────────────────────────────────────────────

class TestPayslip:
    def test_complete_payslip_passes(self):
        chk = validate_payslip(complete_payslip(), complete_employee(), complete_org())
        assert chk.ok, fields(chk)

    def test_pf_deducted_without_uan_blocks(self):
        chk = validate_payslip(complete_payslip(), complete_employee(uan=""), complete_org())
        assert "employee.uan" in fields(chk)

    def test_no_pf_deduction_means_no_uan_requirement(self):
        """An employee below the PF threshold has no UAN and must not be blocked."""
        ps = complete_payslip(pf_employee=0, esi_employee=0, tds=0,
                              total_deductions=200.0, net_pay=144800.0)
        chk = validate_payslip(ps, complete_employee(uan="", esi_number="", pan=""), complete_org())
        assert chk.ok, fields(chk)

    def test_esi_deducted_without_esi_number_blocks(self):
        chk = validate_payslip(complete_payslip(), complete_employee(esi_number=""), complete_org())
        assert "employee.esi_number" in fields(chk)

    def test_tds_deducted_without_pan_blocks(self):
        chk = validate_payslip(complete_payslip(), complete_employee(pan=""), complete_org())
        assert "employee.pan" in fields(chk)
        assert "206AA" in next(g for g in chk.blocking if g.field == "employee.pan").reason

    def test_figures_that_do_not_reconcile_block(self):
        chk = validate_payslip(complete_payslip(net_pay=999.0), complete_employee(), complete_org())
        assert "payslip.net_pay" in fields(chk)

    def test_rounding_within_a_rupee_is_tolerated(self):
        chk = validate_payslip(complete_payslip(net_pay=124700.40), complete_employee(), complete_org())
        assert chk.ok, fields(chk)

    def test_missing_wage_period_blocks(self):
        chk = validate_payslip(complete_payslip(month=""), complete_employee(), complete_org())
        assert "payslip.month" in fields(chk)

    def test_missing_employer_or_employee_name_blocks(self):
        assert "org.name" in fields(
            validate_payslip(complete_payslip(), complete_employee(), {**complete_org(), "name": ""}))
        assert "employee.name" in fields(
            validate_payslip(complete_payslip(), complete_employee(name=""), complete_org()))

    def test_pf_number_gap_is_advisory_because_no_column_exists(self):
        chk = validate_payslip(complete_payslip(), complete_employee(), complete_org())
        assert "employee.pf_number" in {g.field for g in chk.advisory}

    def test_generator_refuses(self):
        from services.payslip_pdf import generate_payslip_pdf
        with pytest.raises(DocumentIncomplete):
            generate_payslip_pdf(complete_payslip(), complete_employee(uan=""), complete_org())


# ── Indian digit grouping ────────────────────────────────────────────────────

class TestIndianGrouping:
    @pytest.mark.parametrize("value,expected", [
        (0, "0.00"),
        (5, "5.00"),
        (999.5, "999.50"),
        (1000, "1,000.00"),
        (99999, "99,999.00"),
        (100000, "1,00,000.00"),
        (548652.2, "5,48,652.20"),
        (10000000, "1,00,00,000.00"),
        (1234567890, "1,23,45,67,890.00"),
        (-4500, "-4,500.00"),
        (None, "0.00"),
        ("not a number", "0.00"),
    ])
    def test_grouping(self, value, expected):
        assert group_indian(value) == expected

    def test_never_western_grouping(self):
        """548,652.00 is the Western short scale and is wrong on an Indian
        statutory document."""
        assert group_indian(548652) == "5,48,652.00"
        assert group_indian(548652) != f"{548652:,.2f}"

    def test_invoice_formatter_uses_it_for_inr_only(self):
        from services.invoice_pdf import _fmt_amount
        assert _fmt_amount(548652, "INR") == "₹5,48,652.00"
        assert _fmt_amount(548652, "USD") == "$548,652.00"


# ── Devanagari ───────────────────────────────────────────────────────────────

# Every fixed Devanagari string that appears across the eight design documents
# in `design-reference/Kartavaya Redesign/docs/`. Extracted from the source, not
# invented — if a document gains a new word, add it here.
DEVANAGARI_REPERTOIRE = (
    "अनुबंध कर्तव्य गणित चालान दस्तावेज़ पत्रावली परियोजना पर्ची प्रतिवेदन "
    "प्रस्ताव प्रेषण बीजक मानव मासिक रिपोर्ट लेखा विवरणी वेतन सेवा हस्ताक्षर "
    "कर बीजक विवरण"
)

# The OpenType GSUB features Devanagari conjunct formation depends on, mapped to
# the specific words in the repertoire above that need each one. HarfBuzz's Indic
# shaper runs these in a fixed order; a font missing one emits the letters
# unjoined, which is visibly wrong and wrong in a way that survives a casual
# glance at a PDF.
CONJUNCT_FEATURES = {
    "nukt": "ज़ in दस्तावेज़ — ja + U+093C nukta",
    "akhn": "क्ष in हस्ताक्षर — the ksha akhand ligature",
    "rphf": "र् in कर्तव्य — ra+virama becomes the repha above the next consonant",
    "blwf": "below-base forms",
    "half": "स्त in प्रस्ताव / हस्ताक्षर — the half form of the first consonant",
    "pres": "pre-base substitutions",
    "abvs": "above-base substitutions (the repha's final position)",
    "psts": "post-base substitutions",
}

# Ra-kar (प्र in प्रस्ताव, प्रतिवेदन, प्रेषण) and generic conjunct formation are
# spelled differently in the two Devanagari shaping models: `vatu`/`haln` in the
# original `deva` tagging, `rkrf`/`cjct` in `dev2`. Tiro is a dev2 font. Either
# spelling satisfies the requirement; having NEITHER does not.
CONJUNCT_ALTERNATES = {
    "ra-kar (प्र)": {"rkrf", "vatu"},
    "conjunct formation": {"cjct", "haln"},
}


def _read_sfnt(path: Path):
    data = path.read_bytes()
    num_tables = struct.unpack(">H", data[4:6])[0]
    tables = {}
    for i in range(num_tables):
        off = 12 + 16 * i
        tag = data[off:off + 4].decode("latin1")
        t_off, t_len = struct.unpack(">II", data[off + 8:off + 16])
        tables[tag] = (t_off, t_len)
    return data, tables


def _cmap_codepoints(data, tables) -> set[int]:
    """Every codepoint the font maps, from its format-4 or format-12 subtable."""
    c_off = tables["cmap"][0]
    n = struct.unpack(">H", data[c_off + 2:c_off + 4])[0]
    chosen = None
    for i in range(n):
        rec = c_off + 4 + 8 * i
        _pid, _eid, sub = struct.unpack(">HHI", data[rec:rec + 8])
        fmt = struct.unpack(">H", data[c_off + sub:c_off + sub + 2])[0]
        if fmt in (4, 12):
            chosen = (fmt, c_off + sub)
    assert chosen, "font has no format-4 or format-12 cmap subtable"
    fmt, base = chosen
    cps: set[int] = set()
    if fmt == 4:
        seg_x2 = struct.unpack(">H", data[base + 6:base + 8])[0]
        seg = seg_x2 // 2
        ends = struct.unpack(f">{seg}H", data[base + 14:base + 14 + seg_x2])
        s_base = base + 14 + seg_x2 + 2
        starts = struct.unpack(f">{seg}H", data[s_base:s_base + seg_x2])
        d_base = s_base + seg_x2
        deltas = struct.unpack(f">{seg}h", data[d_base:d_base + seg_x2])
        r_base = d_base + seg_x2
        ranges = struct.unpack(f">{seg}H", data[r_base:r_base + seg_x2])
        for i in range(seg):
            for cp in range(starts[i], min(ends[i], 0xFFFF) + 1):
                if ranges[i] == 0:
                    gid = (cp + deltas[i]) & 0xFFFF
                else:
                    gi = r_base + 2 * i + ranges[i] + 2 * (cp - starts[i])
                    if gi + 2 > len(data):
                        continue
                    gid = struct.unpack(">H", data[gi:gi + 2])[0]
                    if gid:
                        gid = (gid + deltas[i]) & 0xFFFF
                if gid:
                    cps.add(cp)
    else:  # format 12
        n_groups = struct.unpack(">I", data[base + 12:base + 16])[0]
        for g in range(n_groups):
            go = base + 16 + 12 * g
            start, end, _sg = struct.unpack(">III", data[go:go + 12])
            cps.update(range(start, end + 1))
    return cps


def _gsub_features(data, tables) -> set[str]:
    g_off = tables["GSUB"][0]
    _script_off, feature_off, _lookup_off = struct.unpack(">HHH", data[g_off + 4:g_off + 10])
    f_base = g_off + feature_off
    count = struct.unpack(">H", data[f_base:f_base + 2])[0]
    return {data[f_base + 2 + 6 * i:f_base + 6 + 6 * i].decode("latin1") for i in range(count)}


def _gsub_scripts(data, tables) -> set[str]:
    g_off = tables["GSUB"][0]
    script_off = struct.unpack(">H", data[g_off + 4:g_off + 6])[0]
    s_base = g_off + script_off
    count = struct.unpack(">H", data[s_base:s_base + 2])[0]
    return {data[s_base + 2 + 6 * i:s_base + 6 + 6 * i].decode("latin1") for i in range(count)}


class TestDevanagariFont:
    def test_font_is_vendored(self):
        """The face travels with the repo. Relying on whatever the base image
        installs is how `कर्तव्य` becomes four tofu boxes on a tax invoice."""
        assert has_devanagari_font(), f"missing {DEVANAGARI_FILE}"
        assert DEVANAGARI_FILE.stat().st_size > 100_000

    def test_licence_ships_with_it(self):
        assert (DEVANAGARI_FILE.parent / "OFL.txt").is_file()

    def test_is_a_truetype_with_shaping_tables(self):
        data, tables = _read_sfnt(DEVANAGARI_FILE)
        assert data[:4] == b"\x00\x01\x00\x00"
        for tag in ("cmap", "glyf", "GSUB", "GDEF"):
            assert tag in tables, f"font has no {tag} table"

    def test_covers_every_devanagari_character_the_documents_use(self):
        data, tables = _read_sfnt(DEVANAGARI_FILE)
        cps = _cmap_codepoints(data, tables)
        needed = {ord(c) for c in DEVANAGARI_REPERTOIRE if not c.isspace()}
        missing = sorted(needed - cps)
        assert not missing, "uncovered codepoints: " + ", ".join(f"U+{c:04X}" for c in missing)

    def test_covers_the_virama_that_forms_every_conjunct(self):
        data, tables = _read_sfnt(DEVANAGARI_FILE)
        cps = _cmap_codepoints(data, tables)
        assert 0x094D in cps, "no U+094D DEVANAGARI SIGN VIRAMA — no conjuncts can form"
        assert 0x093C in cps, "no U+093C DEVANAGARI SIGN NUKTA — दस्तावेज़ needs it"

    def test_gsub_declares_devanagari(self):
        data, tables = _read_sfnt(DEVANAGARI_FILE)
        scripts = _gsub_scripts(data, tables)
        assert scripts & {"dev2", "deva"}, f"GSUB scripts are {sorted(scripts)}"

    def test_gsub_carries_the_conjunct_features(self):
        data, tables = _read_sfnt(DEVANAGARI_FILE)
        feats = _gsub_features(data, tables)
        missing = {tag: why for tag, why in CONJUNCT_FEATURES.items() if tag not in feats}
        assert not missing, f"font lacks conjunct features {missing}; has {sorted(feats)}"

    def test_gsub_carries_one_spelling_of_each_alternate_feature(self):
        data, tables = _read_sfnt(DEVANAGARI_FILE)
        feats = _gsub_features(data, tables)
        for what, options in CONJUNCT_ALTERNATES.items():
            assert feats & options, (
                f"font has no feature for {what}: expected one of {sorted(options)}, "
                f"has {sorted(feats)}"
            )


class TestDisplayFace:
    """Newsreader — the `--doc-font-display` serif in brand.css.

    Every PDF this product generates used to render in DejaVu: the stacks named
    Georgia / Times New Roman / Helvetica Neue, none of which the image installs,
    so each fell through to its generic. Vendoring the real face is the fix, and
    these assertions are what stop it regressing.
    """

    FACES = {
        "Newsreader-Regular.ttf": (400, False),
        "Newsreader-SemiBold.ttf": (600, False),
        "Newsreader-Italic.ttf": (400, True),
    }

    def test_all_three_instances_are_vendored(self):
        for name in self.FACES:
            path = DEVANAGARI_FILE.parent / name
            assert path.is_file(), f"missing vendored face {name}"
            assert path.stat().st_size > 50_000

    def test_licence_ships_with_the_family(self):
        assert (DEVANAGARI_FILE.parent / "OFL-Newsreader.txt").is_file()

    @pytest.mark.parametrize("name", sorted(FACES))
    def test_instances_are_static_not_variable(self, name):
        """Upstream publishes Newsreader only as a variable font. Selecting a
        weight off an axis is renderer-dependent; a face that silently renders at
        the wrong weight is the same defect as the DejaVu fallback, one level
        subtler. So the axes are pinned and `fvar` must be gone."""
        _data, tables = _read_sfnt(DEVANAGARI_FILE.parent / name)
        assert "fvar" not in tables, f"{name} is still a variable font"

    @pytest.mark.parametrize("name,expected", sorted(FACES.items()))
    def test_instances_carry_the_weight_and_style_they_claim(self, name, expected):
        weight, italic = expected
        data, tables = _read_sfnt(DEVANAGARI_FILE.parent / name)
        os2_off = tables["OS/2"][0]
        us_weight = struct.unpack(">H", data[os2_off + 4:os2_off + 6])[0]
        fs_selection = struct.unpack(">H", data[os2_off + 62:os2_off + 64])[0]
        assert us_weight == weight, f"{name} reports weight {us_weight}"
        assert bool(fs_selection & 0x01) is italic, f"{name} italic bit is wrong"

    def test_font_face_declares_every_present_face(self):
        css = font_face_css()
        assert css.count("@font-face") == 4  # Tiro + three Newsreader instances
        for name in self.FACES:
            assert (DEVANAGARI_FILE.parent / name).as_uri() in css

    def test_display_stack_names_the_vendored_family_first(self):
        from services.doc_fonts import DISPLAY_STACK
        assert DISPLAY_STACK.startswith("Newsreader")
        # and still degrades rather than dead-ending
        assert "serif" in DISPLAY_STACK

    def test_no_generated_pdf_names_an_uninstalled_face_first(self):
        """Georgia / Times New Roman / Helvetica Neue / Courier New are in no
        build of this image. Naming one FIRST is the bug that made every PDF
        DejaVu."""
        never_first = ("Georgia", '"Times New Roman"', '"Helvetica Neue"', '"Courier New"', "Arial")
        services = Path(__file__).resolve().parent.parent / "services"
        for module in ("invoice_pdf", "payslip_pdf", "report_generator"):
            src = (services / f"{module}.py").read_text(encoding="utf-8")
            for line in src.splitlines():
                m = re.match(r"\s*_FONT_\w+\s*=\s*['\"](.+)['\"]\s*$", line)
                if not m:
                    continue
                first = m.group(1).split(",")[0].strip()
                assert not any(first.strip('"') == n.strip('"') for n in never_first), (
                    f"{module}.py names an uninstalled face first: {line.strip()}"
                )


class TestDevanagariCss:
    def test_font_face_points_at_the_vendored_file(self):
        css = font_face_css()
        assert "@font-face" in css
        assert "Tiro Devanagari Hindi" in css
        assert DEVANAGARI_FILE.as_uri() in css

    def test_declares_weight_400_and_no_synthesis(self):
        """Tiro has one weight. A `font-weight: 700` run would get a synthesised
        bold applied after shaping, which smears the conjunct joins."""
        css = font_face_css()
        assert "font-weight:400" in css
        assert "font-synthesis:none" in css

    def test_never_tracks_devanagari(self):
        """letter-spacing is applied between glyphs after shaping, so any
        tracking detaches a repha from its base. brand.css makes the same
        reservation: .lh__kind sets 0.16em, .lh__kind-hi resets it to 0."""
        css = font_face_css()
        deva_rule = css.split(".deva{", 1)[1]
        assert "letter-spacing:normal" in deva_rule
        assert not re.search(r"\.deva\{[^}]*letter-spacing:\s*-?\d", css)

    def test_span_carries_the_class_and_escapes(self):
        assert deva_span("कर्तव्य", "Kartavya") == '<span class="deva">कर्तव्य</span>'
        assert "<script>" not in deva_span("<script>", "x")

    def test_rendered_documents_wrap_their_devanagari(self):
        """A raw Devanagari literal in the HTML would inherit the Latin family
        stack and fall to whatever fontconfig finds. Every occurrence must go
        through deva_span."""
        for module in ("invoice_pdf", "payslip_pdf"):
            src = (Path(__file__).resolve().parent.parent / "services" / f"{module}.py").read_text(encoding="utf-8")
            body = src.split('"""', 2)[2]  # skip the module docstring
            for match in re.finditer(r"[ऀ-ॿ]+", body):
                line_start = body.rfind("\n", 0, match.start())
                line = body[line_start:body.find("\n", match.end())]
                assert "deva_span(" in line, (
                    f"{module}.py has unwrapped Devanagari {match.group()!r} on: {line.strip()}"
                )
