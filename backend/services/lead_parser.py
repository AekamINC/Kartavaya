"""
lead_parser.py — Parse inbound lead notification emails from IndiaMART and JustDial.
Extracts buyer name, phone, product interest, city, and message via regex.
"""
import re
import logging
from html import unescape

log = logging.getLogger(__name__)


def detect_source(sender: str, subject: str = "") -> str:
    sender_lower = (sender or "").lower()
    subject_lower = (subject or "").lower()
    if "indiamart" in sender_lower or "indiamart" in subject_lower:
        return "indiamart"
    if "justdial" in sender_lower or "justdial" in subject_lower:
        return "justdial"
    return "unknown"


def _strip_html(text: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return unescape(text).strip()


def _clean(val: str) -> str:
    return re.sub(r"\s+", " ", val).strip()[:500]


def _clean_phone(val: str) -> str:
    digits = re.sub(r"[^\d+]", "", val)
    if len(digits) >= 10:
        return digits[-10:] if not digits.startswith("+") else digits
    return ""


def parse_indiamart(body: str) -> dict | None:
    text = _strip_html(body)

    patterns = {
        "name": [
            r"(?:Buyer|Customer|Contact)\s*(?:Name)?\s*[:\-–]\s*(.+)",
            r"Dear\s+Seller.*?from\s+(.+?)(?:\s+has|\s+is|\s*$)",
        ],
        "phone": [
            r"(?:Phone|Mobile|Contact No|Tel)\s*[:\-–]\s*([\d\s\+\-()]+)",
            r"(?:Call|Reach)\s+(?:at|on)\s*[:\-–]?\s*([\d\s\+\-()]+)",
        ],
        "product": [
            r"(?:Product|Item|Enquiry for|Looking for|Interested in)\s*[:\-–]\s*(.+)",
            r"(?:Subject|Regarding)\s*[:\-–]\s*(.+)",
        ],
        "city": [
            r"(?:City|Location|Place|Area)\s*[:\-–]\s*(.+)",
            r"(?:from|in)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:India|IN)?",
        ],
        "message": [
            r"(?:Message|Requirement|Details|Description|Query)\s*[:\-–]\s*(.+?)(?:\n\n|\Z)",
        ],
        "email": [
            r"(?:Email|E-mail)\s*[:\-–]\s*([\w.+-]+@[\w-]+\.[\w.-]+)",
        ],
    }

    result = {}
    for field, pats in patterns.items():
        for pat in pats:
            m = re.search(pat, text, re.I | re.S)
            if m:
                val = _clean(m.group(1))
                if field == "phone":
                    val = _clean_phone(val)
                if val:
                    result[field] = val
                    break

    if not result.get("name") and not result.get("phone"):
        return None

    return result


def parse_justdial(body: str) -> dict | None:
    text = _strip_html(body)

    patterns = {
        "name": [
            r"(?:Name|Customer|Caller)\s*[:\-–]\s*(.+)",
            r"Lead\s+from\s+(.+?)(?:\s+for|\s*$)",
        ],
        "phone": [
            r"(?:Phone|Mobile|Contact)\s*[:\-–]\s*([\d\s\+\-()]+)",
        ],
        "product": [
            r"(?:Category|Service|Product|Looking for)\s*[:\-–]\s*(.+)",
        ],
        "city": [
            r"(?:Area|City|Location)\s*[:\-–]\s*(.+)",
        ],
        "email": [
            r"(?:Email|E-mail)\s*[:\-–]\s*([\w.+-]+@[\w-]+\.[\w.-]+)",
        ],
    }

    result = {}
    for field, pats in patterns.items():
        for pat in pats:
            m = re.search(pat, text, re.I | re.S)
            if m:
                val = _clean(m.group(1))
                if field == "phone":
                    val = _clean_phone(val)
                if val:
                    result[field] = val
                    break

    if not result.get("name") and not result.get("phone"):
        return None

    return result


def parse_lead_email(sender: str, subject: str, body: str) -> tuple[str, dict | None]:
    source = detect_source(sender, subject)

    if source == "indiamart":
        parsed = parse_indiamart(body)
    elif source == "justdial":
        parsed = parse_justdial(body)
    else:
        parsed = parse_indiamart(body) or parse_justdial(body)

    return source, parsed
