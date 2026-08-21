"""connector_setup.py — how the app that fills each card is created.

`connector_credentials.py` answers "which box does this value come from". It
assumes the app ALREADY EXISTS, and for a first-time operator that assumption is
the whole failure: nothing on the Connectors page says how to create a Meta app,
that Instagram needs the Facebook Login product added separately, that LinkedIn
refuses the scopes until two products are attached, or that X cannot post at all
without a paid plan. They fill four correct-looking boxes, press Test, and read
an error the network wrote for a developer.

So each platform gets two lengths of the same truth, from ONE definition:

  `steps`     five-to-eight imperative lines, rendered inside the card. Enough
              to get from a logged-out console to a working id and secret.
  `sections`  the long form for the guide page — prerequisites that are refused
              later rather than at the start, the review or paid gate if there
              is one, and the errors this platform actually produces with what
              each one means.

`errors` is the part worth keeping accurate. "Invalid Client ID" from Meta is not
a permissions problem and never reached one; saying so on the page saves the
operator the hour they would spend re-requesting scopes.

WRITTEN, NOT RE-VERIFIED. These steps are written from each platform's published
developer documentation and from the console paths already recorded in
`connector_credentials.WHERE_CHECKED` (2026-08-07). They have not been walked
through against a live console on the date below. Consoles are renamed often —
treat a step that does not match what is on screen as this file being stale, not
the operator being wrong, and fix it here.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

#: When this file's prose was last written. Deliberately NOT called "checked":
#: see the module docstring.
SETUP_WRITTEN = "2026-08-21"


@dataclass(frozen=True)
class Section:
    """One headed block of the long-form guide."""
    title: str
    body: tuple[str, ...]


@dataclass(frozen=True)
class Guide:
    """Everything a first-time operator needs for one network.

    `prerequisites` are the things a network refuses on LATER — an unlinked
    Instagram account, a Google project without the API enabled, an X account
    without a paid plan. They are listed first because every one of them is
    cheaper to discover before the app is built than after.
    """
    platform: str
    #: The short numbered list rendered inside the connector card.
    steps: tuple[str, ...]
    prerequisites: tuple[str, ...] = ()
    #: The gate between "the test is green" and "a client can actually publish".
    gate: str = ""
    #: (what the network says, what it means and what to do).
    errors: tuple[tuple[str, str], ...] = ()
    sections: tuple[Section, ...] = ()


_META_APP = (
    "Sign in at developers.facebook.com with the Facebook account that "
    "administers the Page, and open My Apps then Create App.",
    "Choose Business as the app type and give it a name your client will "
    "recognise — it is shown to them on the consent screen.",
    "Open Settings then Basic and copy the App ID and App Secret (press Show) "
    "into the card here.",
)

_AFTER_CONNECT = (
    "Saving credentials does not connect anything. It tells the product WHOSE "
    "app to use. Each client is then connected individually from that client's "
    "page, where consent opens in a popup and the account token is stored. "
    "Nothing can publish until that second step is done for that client."
)


GUIDES: tuple[Guide, ...] = (
    Guide(
        "facebook",
        prerequisites=(
            "A Facebook Page — not a personal profile. Personal profiles cannot "
            "be posted to by any API.",
            "The account you build the app with must be an admin of that Page.",
        ),
        steps=_META_APP + (
            "In the app, open Products, add Facebook Login, open its Settings, "
            "and paste the redirect URL shown on this card into Valid OAuth "
            "Redirect URIs. Consent fails before it starts if this is missing.",
            "Under App Review → Permissions and Features, request "
            "pages_manage_posts and pages_read_engagement.",
            "Press Test connection here, then connect each client from their "
            "own page.",
        ),
        gate="A Meta app starts in Development mode, where it works ONLY for "
             "people listed as admins, developers or testers of the app. Real "
             "clients can consent only after App Review approves the two page "
             "permissions and the app is switched Live.",
        errors=(
            ("Invalid Client ID",
             "Meta does not recognise the App ID. It is the number under "
             "Settings → Basic → App ID — not the Page ID, not the Business ID, "
             "and not the app's name."),
            ("Invalid Client Secret, or a client secret mismatch",
             "The id is real but the secret is not its pair. Press Show on "
             "Settings → Basic and copy it again; resetting the secret "
             "invalidates the old one immediately."),
            ("URL blocked, or redirect_uri is not allowed",
             "The redirect URL on this card is not in Valid OAuth Redirect "
             "URIs. It must match character for character, including https."),
        ),
        sections=(
            Section("After the credentials are saved", (_AFTER_CONNECT,)),
        ),
    ),

    Guide(
        "instagram",
        prerequisites=(
            "The Instagram account must be a Professional account (Business or "
            "Creator). A personal account cannot be published to by any API, "
            "and no app setting changes that.",
            "That Professional account must be linked to a Facebook Page, from "
            "the Instagram app → Settings → Account → Linked accounts. Meta "
            "publishes to Instagram THROUGH the Page.",
        ),
        steps=(
            "Use the SAME Meta app as the Facebook card — App ID and App Secret "
            "from Settings → Basic. Only build a second app if this client "
            "genuinely needs their own.",
            "In that app, add the Instagram Graph API product, and Facebook "
            "Login if the Facebook card has not already added it.",
            "Paste the redirect URL from this card into Facebook Login → "
            "Settings → Valid OAuth Redirect URIs.",
            "Under App Review, request instagram_basic, "
            "instagram_content_publish, pages_show_list and "
            "pages_read_engagement.",
            "Press Test connection, then connect the client from their page and "
            "pick the Instagram account in the consent popup.",
        ),
        gate="Publishing needs instagram_content_publish, which is granted by "
             "App Review, and the app must be Live. In Development mode only "
             "the app's own admins and testers can complete consent.",
        errors=(
            ("Invalid Client ID",
             "Meta does not recognise the App ID. Copy it again from Settings → "
             "Basic; a Page ID or Business ID pasted here produces exactly this "
             "message. It is NOT a permissions problem — the check never got as "
             "far as permissions."),
            ("No Instagram account appears in the consent popup",
             "The account is still personal, or it is not linked to the Page "
             "being granted. Fix it in the Instagram app, then reconnect."),
            ("The media could not be published, or a (#10) permission error",
             "instagram_content_publish has not been approved, or the app is "
             "still in Development mode."),
        ),
        sections=(
            Section("Why there are two cards for one Meta app", (
                "Instagram and Facebook are separate rows so an agency can point "
                "one client's Instagram at a different app than their Facebook. "
                "Most organisations paste the same id and secret into both.",
            )),
            Section("After the credentials are saved", (_AFTER_CONNECT,)),
        ),
    ),

    Guide(
        "threads",
        prerequisites=(
            "A Threads profile, which exists only alongside an Instagram "
            "account.",
        ),
        steps=_META_APP + (
            "Add the Threads API product to the app — it is separate from "
            "Facebook Login and from the Instagram Graph API, and adding those "
            "does not add this.",
            "Paste the redirect URL from this card into the Threads API "
            "product's redirect settings.",
            "Request threads_basic and threads_content_publish under App "
            "Review.",
        ),
        gate="threads_content_publish is granted by App Review. Until then the "
             "app posts only as its own testers.",
        errors=(
            ("Invalid Client ID",
             "The App ID is wrong, or the Threads API product was never added "
             "to this app."),
        ),
        sections=(
            Section("After the credentials are saved", (_AFTER_CONNECT,)),
        ),
    ),

    Guide(
        "linkedin",
        prerequisites=(
            "A LinkedIn Company Page. The app is created against a Page, and "
            "you must be one of its admins.",
        ),
        steps=(
            "Sign in at linkedin.com/developers/apps and press Create app.",
            "Attach it to your Company Page and verify the app from the link "
            "LinkedIn generates — an unverified app cannot request products.",
            "On the Products tab, add BOTH Sign In with LinkedIn using OpenID "
            "Connect and Share on LinkedIn. Without them the scopes are refused "
            "at consent time, not at save time.",
            "On the Auth tab, paste the redirect URL from this card into OAuth "
            "2.0 settings → Authorized redirect URLs.",
            "Copy the Client ID and Primary Client Secret from that same Auth "
            "tab into this card.",
        ),
        gate="Posting to a Company Page (rather than a personal profile) needs "
             "the Community Management API, which LinkedIn grants by "
             "application and not to every developer.",
        errors=(
            ("LinkedIn rejected this client id and secret",
             "A genuine 401. Re-copy both values from the Auth tab."),
            ("unauthorized_scope_error",
             "The id and secret are RIGHT. The app is missing a product — "
             "almost always Share on LinkedIn."),
            ("The redirect_uri does not match the registered value",
             "The Authorized redirect URL on the Auth tab differs from the one "
             "on this card. It is an exact string match."),
        ),
        sections=(
            Section("Why Test connection can pass and posting still fail", (
                "LinkedIn refuses client_credentials for most apps, so the test "
                "can only distinguish a wrong secret (401) from a right one "
                "(400 unauthorized_scope). A green tick here means the pair is "
                "real, not that the products are attached.",
            )),
            Section("After the credentials are saved", (_AFTER_CONNECT,)),
        ),
    ),

    Guide(
        "google_business",
        prerequisites=(
            "A verified Google Business Profile location, owned or managed by "
            "the Google account that will consent.",
        ),
        steps=(
            "Open console.cloud.google.com and create a project, or pick an "
            "existing one.",
            "Under APIs & Services → Library, enable the Business Profile APIs. "
            "Enabling is not enough on its own — see the gate below.",
            "Configure the OAuth consent screen: External, with the app name "
            "and support email filled in.",
            "Under Credentials → Create credentials → OAuth client ID, choose "
            "Web application, and paste the redirect URL from this card into "
            "Authorised redirect URIs.",
            "Copy the Client ID and Client secret into this card.",
        ),
        gate="Google grants Business Profile API access per project, by form, "
             "after enabling. Until that request is approved the API returns "
             "permission errors even with a perfect OAuth client. Separately, "
             "an External consent screen in Testing mode only admits the test "
             "users you list.",
        errors=(
            ("Google rejected this client id and secret",
             "invalid_client — wrong client id or secret, or the OAuth client "
             "was deleted."),
            ("Google recognised this client id and secret",
             "invalid_grant against a deliberately fake code. That is the pass "
             "condition: the client was accepted."),
            ("access_denied at consent",
             "The consent screen is in Testing and this Google account is not "
             "on the test users list."),
        ),
        sections=(
            Section("After the credentials are saved", (_AFTER_CONNECT,)),
        ),
    ),

    Guide(
        "youtube",
        prerequisites=(
            "A YouTube channel on the Google account that will consent.",
        ),
        steps=(
            "Use the same Google Cloud project as Business Profile if you have "
            "one — the OAuth client can be shared.",
            "Under APIs & Services → Library, enable YouTube Data API v3.",
            "Under Credentials → OAuth 2.0 Client IDs, use the existing Web "
            "application client or create one, and add the redirect URL from "
            "this card to its Authorised redirect URIs.",
            "Copy the Client ID and Client secret into this card.",
        ),
        gate="Uploads cost a large share of the daily quota. A new project's "
             "default quota allows only a handful of uploads per day until "
             "Google grants an increase, and an unaudited app's uploads are "
             "locked to private.",
        errors=(
            ("Google rejected this client id and secret",
             "invalid_client — re-copy both from the Credentials page."),
            ("quotaExceeded",
             "The project's daily YouTube quota is spent. Not a credentials "
             "problem; it resets on Pacific midnight."),
        ),
        sections=(
            Section("After the credentials are saved", (_AFTER_CONNECT,)),
        ),
    ),

    Guide(
        "twitter",
        prerequisites=(
            "A PAID X developer plan. Basic and above can create posts; the "
            "Free access level cannot, at any price of effort.",
        ),
        steps=(
            "Sign in at developer.x.com/en/portal/dashboard and create a "
            "project, then an app inside it.",
            "Open the app's User authentication settings and turn on OAuth 2.0.",
            "Set the app type to Web App, Automated App or Bot. A Native or "
            "Single-page type issues no client secret.",
            "Paste the redirect URL from this card into Callback URI / Redirect "
            "URL, and fill the Website URL field — it is required.",
            "Set the scopes to tweet.write, tweet.read, users.read and "
            "offline.access.",
            "From Keys and tokens, copy the OAuth 2.0 Client ID and Client "
            "Secret. The secret is shown ONCE — regenerate it if it was not "
            "copied.",
        ),
        gate="Posting is a paid tier. A correct id and secret on a Free account "
             "return 403 on every write, which this product reports as "
             "'recognised the credentials but this access level cannot post'.",
        errors=(
            ("X rejected this client id and secret",
             "The pair is wrong, or the app type has no secret. Check the app "
             "is a Web App."),
            ("X recognised the credentials but this access level cannot post",
             "A 403. The credentials are correct and the plan is the problem. "
             "Confirm the plan before promising a client that X works."),
        ),
        sections=(
            Section("After the credentials are saved", (_AFTER_CONNECT,)),
        ),
    ),

    Guide(
        "pinterest",
        steps=(
            "Sign in at developers.pinterest.com with a Pinterest business "
            "account and create an app.",
            "Under Configure, paste the redirect URL from this card into the "
            "Redirect URIs.",
            "Copy the App ID and App secret key into this card.",
            "Request standard access from that same page when trial access "
            "stops being enough.",
        ),
        gate="A new Pinterest app has Trial access and can only post to the "
             "developer's own boards. Client boards need standard access, which "
             "Pinterest grants by review.",
        errors=(
            ("Invalid client, or unauthorized",
             "Re-copy the App ID and secret key from Configure."),
        ),
        sections=(
            Section("After the credentials are saved", (_AFTER_CONNECT,)),
        ),
    ),

    Guide(
        "reddit",
        steps=(
            "Open reddit.com/prefs/apps and press create another app.",
            "Choose the web app type. A script app cannot complete a consent "
            "round-trip and will fail at Connect.",
            "Paste the redirect URL from this card into the redirect uri box.",
            "The Client ID is the unlabelled string directly under the app's "
            "name; the secret is the field labelled secret.",
        ),
        gate="Reddit rate-limits by app and requires a descriptive user agent. "
             "Subreddits also enforce their own posting rules, which no API "
             "permission overrides.",
        errors=(
            ("unsupported_grant_type, or an invalid app type",
             "The app was created as a script rather than a web app."),
        ),
        sections=(
            Section("After the credentials are saved", (_AFTER_CONNECT,)),
        ),
    ),

    Guide(
        "whatsapp_business",
        prerequisites=(
            "A verified Meta Business account.",
            "A phone number that is NOT active on the normal WhatsApp or "
            "WhatsApp Business app. Registering it for the Cloud API takes it "
            "over.",
        ),
        steps=(
            "In a Meta app, add the WhatsApp product and complete API Setup.",
            "Copy the Phone number ID and the WhatsApp Business Account ID from "
            "API Setup. The phone number ID is a long number — if you typed "
            "+91…, it is the wrong value.",
            "In Business settings → Users → System users, create a system user "
            "and generate a token with whatsapp_business_messaging and "
            "whatsapp_business_management. The token on the API Setup page "
            "expires in 24 hours and is not the one to save.",
            "Invent a long random string as the verify token and type it into "
            "this card.",
            "In Meta app → WhatsApp → Configuration → Webhook, paste the "
            "callback URL from this card and the SAME verify token, then "
            "subscribe to the messages field.",
        ),
        gate="Business-initiated messages need an approved message template. "
             "Free-form replies are allowed only inside the 24-hour window "
             "after the customer's last message.",
        errors=(
            ("Meta refused this (401)",
             "The access token is wrong, expired, or was generated against a "
             "user rather than a system user."),
            ("Meta said: Unsupported get request",
             "The phone number ID is wrong — often a WABA ID, or the phone "
             "number itself pasted into that box."),
            ("The webhook never verifies",
             "The verify token in Meta's console does not match the one saved "
             "here. It is a shared password between the two consoles."),
        ),
        sections=(
            Section("This one is not OAuth", (
                "Nothing opens a consent popup. All four values are copied by "
                "hand, and the connection is live as soon as they are correct "
                "and the webhook is subscribed.",
            )),
        ),
    ),

    Guide(
        "justdial",
        steps=(
            "Save this card first — the webhook URL below is generated from it.",
            "Send that webhook URL to your JustDial account manager and ask for "
            "leads to be pushed to it. It is not self-service from the seller "
            "dashboard.",
            "The API key, if your account manager issues one, goes in this "
            "card; the campaign or listing ID is optional and only narrows "
            "which listing's leads are accepted.",
        ),
        gate="JustDial pushes; there is nothing to call. Until the account "
             "manager configures the push, this card is saved and idle.",
        errors=(
            ("No leads arrive",
             "Either the push was never configured on JustDial's side, or the "
             "URL was copied before the card was saved."),
        ),
        sections=(
            Section("The URL is the credential", (
                "Anyone holding that webhook URL can post a lead into this "
                "organisation. Clear and re-save the card to rotate it.",
            )),
        ),
    ),

    Guide(
        "indiamart",
        steps=(
            "Open seller.indiamart.com → Lead Manager → CRM API and press "
            "Generate key.",
            "Paste the key into this card, with the mobile number the seller "
            "account is registered against — the CRM API keys its calls on it.",
            "Nothing else is needed. Enquiries are fetched every 15 minutes and "
            "land in Graha as contacts.",
        ),
        gate="15 minutes is IndiaMART's own documented limit, not a setting.",
        errors=(
            ("Leads stop arriving",
             "The CRM key was regenerated in the seller panel, which "
             "invalidates the saved one."),
        ),
        sections=(
            Section("Duplicates", (
                "A lead is matched to an existing contact by IndiaMART's query "
                "id, then by phone, then by email — the same person enquiring "
                "twice does not become two rows.",
            )),
        ),
    ),
)

GUIDES_BY_KEY: dict[str, Guide] = {g.platform: g for g in GUIDES}


def guide(platform: str) -> Optional[Guide]:
    return GUIDES_BY_KEY.get(platform)


def short_steps(platform: str) -> list[str]:
    """The numbered list rendered inside the card. [] when there is no guide."""
    g = GUIDES_BY_KEY.get(platform)
    return list(g.steps) if g else []


def public_guide(platform: str) -> dict:
    """The long form, for the guide page. Empty dict for an unknown platform."""
    g = GUIDES_BY_KEY.get(platform)
    if not g:
        return {}
    return {
        "platform": g.platform,
        "steps": list(g.steps),
        "prerequisites": list(g.prerequisites),
        "gate": g.gate,
        "errors": [{"says": s, "means": m} for s, m in g.errors],
        "sections": [{"title": s.title, "body": list(s.body)} for s in g.sections],
        "written": SETUP_WRITTEN,
    }
