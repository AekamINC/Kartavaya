"""
social_publisher.py — Post content to social platforms via OAuth APIs.
Supports Facebook/Instagram (Meta Graph API), LinkedIn, Google Business Profile.
Includes token refresh for Meta and LinkedIn.

METERING (added 2026-08-04) — WHAT META ACTUALLY BILLS
──────────────────────────────────────────────────────
Publishing was entirely unmetered. For the OAuth platforms that is nearly
harmless — Facebook, Instagram, LinkedIn, Google Business, YouTube, Pinterest,
Threads, Telegram, TikTok and Reddit all bill by API *quota*, not per message,
so a post costs us nothing per call. They are priced at 0 as
`channel/social_send` so that the ledger records the event: an org needs to be
able to see what it published and when, and a report that shows nothing cannot.

WhatsApp is different and is the reason this file is in the credit programme.
`publish_to_whatsapp_business` calls the WhatsApp Cloud API, which Meta bills
for. It is charged 1 credit as `channel/whatsapp_send`.

THE LIMITATION, NAMED SO IT IS A KNOWN DEBT AND NOT A DISCOVERY:
Meta does not bill per message. It bills per 24-hour *conversation* between one
business phone number and one recipient, and the rate depends on the category
(marketing / utility / authentication / service). Charging per send therefore
mismatches Meta's meter in BOTH directions:
  · a second send to the same recipient inside an open 24h window costs Meta
    nothing extra and costs the customer 1 credit — an over-charge;
  · a marketing template opening a new conversation costs Meta several times a
    service reply, and both cost the customer the same 1 credit.
Neither can be fixed here. Deduplicating by conversation needs the recipient and
the window, and this codebase stores neither: `hub_publish_queue` has no
recipient column, and the `to` field below is read from
`account["metadata"]["broadcast_list"]`, a key nothing in the product ever
writes. Closing this properly means recording the recipient and the conversation
window on the queue row, which is schema work and belongs to whoever owns 095's
successor — not to a `.get()` chain guessing in here.

CHARGED AFTER THE SEND, NOT BEFORE — the one place in the credit programme that
does. Everywhere else charging first is what stops concurrent work from spending
one balance twice; a queue row is already serialised by its own `status`, so
there is nothing to race. What matters instead is that Meta bills for a
delivered conversation, and an API call that raised delivered nothing. Charging
first and refunding would write two ledger rows for every failed attempt — and
because `broadcast_list` is never populated, today that is *every* WhatsApp
attempt. A suppressed publish (OUTBOUND_MODE=dry) makes no external call at all
and is likewise not charged.
"""
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx

from db import get_pool
from services import credits
from services.encryption import decrypt, encrypt
from outbound import sending

log = logging.getLogger(__name__)

#: Which price key each platform is charged under, as a `channel` kind. Meta
#: charges for WhatsApp Cloud API traffic; every other platform here is
#: quota-limited rather than per-message billed. The numbers themselves belong
#: to services/credits.py — this only decides WHICH price applies.
_PAID_PLATFORMS = {"whatsapp_business": "whatsapp_send"}
_FREE_PLATFORM_PRICE = "social_send"


def _guarded(fn):
    """Suppress a publish when OUTBOUND_MODE=dry, and record every one either way.

    Applied to every publish_to_* entry point rather than to their callers, so
    a new platform or a new caller is covered without anyone remembering to.

    These post through per-client OAuth tokens to a customer's own audience.
    A wrong post is public and not reliably retractable, which is why this is
    the one channel guarded at every entry rather than at a dispatcher.

    The outbound record is written in the same place and for the same reason.
    `hub_publish_queue` already stores an outcome per queue row, but a queue row
    is the customer's request; this is the call we made on it. The two differ
    exactly when it matters — a suppressed publish leaves the queue row saying
    'published' with a NULL post id, and only this row says the post was never
    made. The queue is also per-content, so it cannot answer "what did this
    product send today, across every channel", which is the question the SES
    bill asked and nothing could answer.
    """
    async def _wrapper(account: dict, text: str, media_urls: list = None) -> dict:
        platform = fn.__name__.replace("publish_to_", "")
        target = account.get("account_name") or account.get("page_id") or account.get("account_id") or ""

        # `publish_content` is the only caller, and the dict it passes is a
        # hub_publish_queue row joined to the account — so `id` here is the QUEUE
        # id and `client_org_id` came from hub_clients. Both are read behind the
        # same test because they arrive together: a dict without `client_org_id`
        # is not a queue row, and stamping "publish:<social account id>" on a row
        # that claims to name a queue entry is worse than leaving it null. `ref`
        # then matches `_charge_for_publish`'s idempotency key exactly, so this
        # row and the credit ledger's row line up without a lookup table.
        queue_id = account.get("id") if account.get("client_org_id") else None

        # WHAT WAS PUBLISHED, NOT WHAT IT SAID.
        #
        # This argument lands in the subject position, and it used to be
        # `(text or "")[:80]` — the opening of the customer's own post, sent
        # through the customer's own OAuth token. 098 spends a paragraph on that
        # exact expression and the writer's `_NO_SUBJECT_CHANNELS` drops it for
        # the `social` family. But `social:whatsapp_business` is translated to
        # the `whatsapp` family, which keeps its subject — so on the one
        # platform where the text is a private message to one person, eighty
        # characters of it were being kept for 400 days and read by support.
        # The dry-run warning line carries the same string into Railway logs.
        # Neither is a place for a client's copy, so it stops being passed at
        # all rather than being dropped further downstream.
        #
        # The content item identifies the post without quoting a word of it,
        # and it is the better identifier than the queue row: one content item
        # fans out to a queue row per platform, and `ref` already names the row.
        # `publish_content` passes a queue row joined to its account, so
        # `content_id` arrives through `q.*`; a direct caller has no queue row
        # and gets the platform instead of nothing.
        content_id = account.get("content_id")
        names_the_post = f"content {content_id}" if content_id else f"{platform} post"

        # `sending` rather than `begin` because the failure branch here is the
        # one that must never be forgotten: a publish that raises is the case
        # `publish_content` turns into a retry, and a retry that posts twice is
        # the one outcome on this channel nobody can take back.
        #
        # `purpose` is stated rather than left to be derived from `ref`, which
        # is the same word: a publish with no queue row to name is still a
        # publish, and without this it would be the only one filed under
        # 'unclassified'.
        with sending(
            f"social:{platform}", str(target), names_the_post,
            org_id=account.get("client_org_id"),
            user_id=account.get("created_by"),
            ref=f"publish:{queue_id}" if queue_id else None,
            purpose="publish",
        ) as att:
            if att.blocked:
                return {"platform_post_id": None, "platform_url": None, "suppressed": True}
            result = await fn(account, text, media_urls)
            # The platform's own post id. It is what makes the row checkable
            # against the platform afterwards — and on a suppressed run it is
            # exactly what the queue row does NOT have, which is how the two can
            # be told apart at all.
            att.sent(result.get("platform_post_id") if isinstance(result, dict) else None)
            return result

    _wrapper.__name__ = fn.__name__
    _wrapper.__doc__ = fn.__doc__
    return _wrapper


def with_plain_tokens(row) -> dict:
    """A row of `hub_social_accounts` with its tokens decrypted.

    ONE PLACE, because there were two readers and only one of them did it.
    `_get_account` decrypted; `publish_content` selected `sa.access_token`
    through a JOIN and handed the CIPHERTEXT straight to the platform. Every
    scheduled post and every cron dispatch would have failed with a token no
    network ever issued, and the error would have come back from Facebook
    rather than from here — so it would have read as the customer's
    credentials being wrong.

    It never surfaced because `hub_social_accounts` has been empty for the
    whole life of the feature. The first firm to connect an account would have
    found it.

    `decrypt` passes unmarked values through, so rows written before encryption
    keep working, and calling this on an already-plain dict is harmless.
    """
    acct = dict(row)
    for col in ("access_token", "refresh_token"):
        if acct.get(col):
            acct[col] = decrypt(acct[col])
    return acct


async def _get_account(account_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM staging.hub_social_accounts WHERE id=$1::uuid AND is_active=TRUE",
        account_id,
    )
    if not row:
        return None
    return with_plain_tokens(row)


async def _refresh_token_if_needed(account: dict) -> dict:
    """Check if token is expired and refresh if possible. Returns updated account dict."""
    expires = account.get("token_expires_at")
    if not expires or expires > datetime.now(timezone.utc):
        return account

    platform = account["platform"]
    refresh_token = account.get("refresh_token")
    if not refresh_token:
        log.warning("Token expired for %s account %s but no refresh token", platform, account["id"])
        account["_token_expired"] = True
        return account

    try:
        if platform in ("facebook", "instagram"):
            new_token = await _refresh_meta_token(account["access_token"])
        elif platform == "linkedin":
            new_token = await _refresh_linkedin_token(refresh_token)
        else:
            return account

        pool = await get_pool()
        await pool.execute(
            "UPDATE staging.hub_social_accounts SET access_token=$1, updated_at=NOW() "
            "WHERE id=$2::uuid",
            # Re-encrypted on write. A refresh that stored plaintext would
            # silently undo the encryption for the busiest accounts first.
            encrypt(new_token), str(account["id"]),
        )
        account["access_token"] = new_token
        log.info("Refreshed %s token for account %s", platform, account["id"])
    except Exception as exc:
        log.error("Token refresh failed for %s account %s: %s", platform, account["id"], exc)
        account["_token_expired"] = True

    return account


async def _refresh_meta_token(current_token: str) -> str:
    """Exchange a short-lived Meta token for a long-lived one."""
    app_id = os.getenv("META_APP_ID", "")
    app_secret = os.getenv("META_APP_SECRET", "")
    if not app_id or not app_secret:
        raise ValueError("META_APP_ID and META_APP_SECRET required for token refresh")

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://graph.facebook.com/v21.0/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": app_id,
                "client_secret": app_secret,
                "fb_exchange_token": current_token,
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


async def _refresh_linkedin_token(refresh_token: str) -> str:
    """Refresh a LinkedIn OAuth2 token."""
    client_id = os.getenv("LINKEDIN_CLIENT_ID", "")
    client_secret = os.getenv("LINKEDIN_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise ValueError("LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET required for token refresh")

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


# ── Platform publishers ───────────────────────────────────

@_guarded
async def publish_to_facebook(account: dict, text: str, media_urls: list = None) -> dict:
    """Post to a Facebook Page."""
    page_id = account.get("page_id") or account.get("account_id")
    token = account["access_token"]

    async with httpx.AsyncClient(timeout=30) as client:
        if media_urls:
            resp = await client.post(
                f"https://graph.facebook.com/v21.0/{page_id}/photos",
                data={"message": text, "url": media_urls[0], "access_token": token},
            )
        else:
            resp = await client.post(
                f"https://graph.facebook.com/v21.0/{page_id}/feed",
                data={"message": text, "access_token": token},
            )
        resp.raise_for_status()
        data = resp.json()

    post_id = data.get("id") or data.get("post_id")
    return {
        "platform_post_id": post_id,
        "platform_url": f"https://facebook.com/{post_id}" if post_id else None,
    }


@_guarded
async def publish_to_instagram(account: dict, text: str, media_urls: list = None) -> dict:
    """Post to Instagram Business (requires image)."""
    ig_id = account.get("page_id") or account.get("account_id")
    token = account["access_token"]

    if not media_urls:
        raise ValueError("Instagram requires at least one image")

    async with httpx.AsyncClient(timeout=30) as client:
        container = await client.post(
            f"https://graph.facebook.com/v21.0/{ig_id}/media",
            data={"image_url": media_urls[0], "caption": text, "access_token": token},
        )
        container.raise_for_status()
        creation_id = container.json()["id"]

        publish = await client.post(
            f"https://graph.facebook.com/v21.0/{ig_id}/media_publish",
            data={"creation_id": creation_id, "access_token": token},
        )
        publish.raise_for_status()
        data = publish.json()

    return {
        "platform_post_id": data.get("id"),
        "platform_url": None,
    }


def _account_meta(account: dict) -> dict:
    """The row's `metadata`, whichever name the caller's SELECT gave it.

    `_get_account` selects `*`, so the key is `metadata`. `publish_content`
    aliases it to `acct_meta` to keep `q.*` from colliding with it. Both reach
    the publishers, so both are read here rather than in each publisher.

    Returns `{}` for a row that has none, which is every row written before the
    destination picker existed.
    """
    meta = account.get("metadata")
    if meta is None:
        meta = account.get("acct_meta")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except (TypeError, ValueError):
            return {}
    return meta if isinstance(meta, dict) else {}


def linkedin_author_urn(account: dict) -> str:
    """WHOSE FEED. A person's, or a Company Page's — and BOTH must work.

    The owner, asked whether LinkedIn should post as a person or a Company Page:
    "any connectors can do both. depends on org — someone org is sole business
    owner who is its own page." A sole practitioner IS their own brand and posts
    as themselves; a firm posts as its Page. Deciding for them is the bug.

    THREE SOURCES, in order, and the order is the point:

      1. `metadata.destination_kind`, which the picker wrote. `linkedin_
         organization` builds an organisation urn, `person` builds a person urn.
         This is the only source that KNOWS.
      2. A stored value that is already a urn — the picker stores the full urn in
         `account_id` precisely because it is unambiguous, and an urn that says
         `organization` is not made a person by an absent metadata key.
      3. A bare id, which is a row written before any of this existed. It gets a
         PERSON urn, because that is the only thing the old
         `_fetch_linkedin_profile` ever stored (`sub` from /v2/userinfo) and
         guessing organisation for it would post a firm's words somewhere it
         has never posted before.

    Exported rather than inlined so the two shapes can be asserted against
    directly — `tests/test_destination_picker.py`.
    """
    author = (account.get("account_id") or "").strip()
    kind = _account_meta(account).get("destination_kind", "")

    if kind == "linkedin_organization":
        bare = author.rsplit(":", 1)[-1] if author.startswith("urn:") else author
        return f"urn:li:organization:{bare}"
    if kind == "person":
        bare = author.rsplit(":", 1)[-1] if author.startswith("urn:") else author
        return f"urn:li:person:{bare}"

    if author.startswith("urn:"):
        return author
    return f"urn:li:person:{author}"


@_guarded
async def publish_to_linkedin(account: dict, text: str, media_urls: list = None) -> dict:
    """Post to LinkedIn (personal or organization)."""
    token = account["access_token"]
    author_urn = linkedin_author_urn(account)

    payload = {
        "author": author_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": text},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.linkedin.com/v2/ugcPosts",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "X-Restli-Protocol-Version": "2.0.0",
            },
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    post_id = data.get("id", "")
    return {
        "platform_post_id": post_id,
        "platform_url": f"https://www.linkedin.com/feed/update/{post_id}" if post_id else None,
    }


@_guarded
async def publish_to_google_business(account: dict, text: str, media_urls: list = None) -> dict:
    """Post to Google Business Profile (local post)."""
    token = account["access_token"]
    location_id = account.get("page_id") or account.get("account_id")

    post_body = {
        "languageCode": "en",
        "summary": text,
        "topicType": "STANDARD",
    }

    if media_urls:
        post_body["media"] = [
            {"mediaFormat": "PHOTO", "sourceUrl": url}
            for url in media_urls[:5]
        ]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://mybusiness.googleapis.com/v4/{location_id}/localPosts",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=post_body,
        )
        resp.raise_for_status()
        data = resp.json()

    post_name = data.get("name", "")
    search_url = data.get("searchUrl", "")
    return {
        "platform_post_id": post_name,
        "platform_url": search_url or None,
    }


@_guarded
async def publish_to_youtube(account: dict, text: str, media_urls: list = None) -> dict:
    """Upload a video to YouTube via Data API v3."""
    token = account["access_token"]
    if not media_urls:
        raise ValueError("YouTube requires a video URL")

    metadata = {
        "snippet": {
            "title": text[:100] if text else "Untitled",
            "description": text,
            "categoryId": "22",
        },
        "status": {"privacyStatus": "public"},
    }
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=metadata,
        )
        resp.raise_for_status()
        upload_url = resp.headers.get("location", "")

        if upload_url and media_urls:
            video_resp = await client.get(media_urls[0])
            video_resp.raise_for_status()
            up = await client.put(
                upload_url,
                content=video_resp.content,
                headers={"Content-Type": "video/*"},
            )
            up.raise_for_status()
            data = up.json()
            video_id = data.get("id", "")
            return {
                "platform_post_id": video_id,
                "platform_url": f"https://youtube.com/watch?v={video_id}" if video_id else None,
            }

    return {"platform_post_id": None, "platform_url": None}


@_guarded
async def publish_to_pinterest(account: dict, text: str, media_urls: list = None) -> dict:
    """Create a Pin on Pinterest."""
    token = account["access_token"]
    board_id = account.get("page_id") or account.get("account_id")
    pin_data = {
        "board_id": board_id,
        "description": text,
    }
    if media_urls:
        pin_data["media_source"] = {"source_type": "image_url", "url": media_urls[0]}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.pinterest.com/v5/pins",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=pin_data,
        )
        resp.raise_for_status()
        data = resp.json()
    pin_id = data.get("id", "")
    return {
        "platform_post_id": pin_id,
        "platform_url": f"https://pinterest.com/pin/{pin_id}" if pin_id else None,
    }


@_guarded
async def publish_to_threads(account: dict, text: str, media_urls: list = None) -> dict:
    """Publish to Threads (Meta) via Graph API."""
    token = account["access_token"]
    user_id = account.get("account_id")

    container_data = {"text": text, "media_type": "TEXT", "access_token": token}
    if media_urls:
        container_data["media_type"] = "IMAGE"
        container_data["image_url"] = media_urls[0]

    async with httpx.AsyncClient(timeout=30) as client:
        container = await client.post(
            f"https://graph.threads.net/v1.0/{user_id}/threads",
            data=container_data,
        )
        container.raise_for_status()
        creation_id = container.json()["id"]

        publish = await client.post(
            f"https://graph.threads.net/v1.0/{user_id}/threads_publish",
            data={"creation_id": creation_id, "access_token": token},
        )
        publish.raise_for_status()
        data = publish.json()

    return {"platform_post_id": data.get("id"), "platform_url": None}


@_guarded
async def publish_to_telegram(account: dict, text: str, media_urls: list = None) -> dict:
    """Send a message to a Telegram channel via Bot API."""
    bot_token = account["access_token"]
    chat_id = account.get("page_id") or account.get("account_id")

    async with httpx.AsyncClient(timeout=30) as client:
        if media_urls:
            resp = await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendPhoto",
                data={"chat_id": chat_id, "caption": text, "photo": media_urls[0]},
            )
        else:
            resp = await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                data={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            )
        resp.raise_for_status()
        data = resp.json()

    msg_id = data.get("result", {}).get("message_id", "")
    return {
        "platform_post_id": str(msg_id),
        "platform_url": f"https://t.me/{chat_id.lstrip('@')}/{msg_id}" if msg_id and chat_id else None,
    }


@_guarded
async def publish_to_tiktok(account: dict, text: str, media_urls: list = None) -> dict:
    """Publish a video to TikTok via Content Posting API."""
    token = account["access_token"]
    if not media_urls:
        raise ValueError("TikTok requires a video URL")

    async with httpx.AsyncClient(timeout=60) as client:
        init = await client.post(
            "https://open.tiktokapis.com/v2/post/publish/video/init/",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "post_info": {"title": text[:150], "privacy_level": "PUBLIC_TO_EVERYONE"},
                "source_info": {"source": "PULL_FROM_URL", "video_url": media_urls[0]},
            },
        )
        init.raise_for_status()
        data = init.json()
    publish_id = data.get("data", {}).get("publish_id", "")
    return {"platform_post_id": publish_id, "platform_url": None}


@_guarded
async def publish_to_reddit(account: dict, text: str, media_urls: list = None) -> dict:
    """Submit a post to a subreddit."""
    token = account["access_token"]
    subreddit = account.get("page_id") or account.get("account_id")

    post_data = {
        "sr": subreddit,
        "title": text[:300] if text else "Post",
        "kind": "self",
        "text": text,
    }
    if media_urls:
        post_data["kind"] = "link"
        post_data["url"] = media_urls[0]
        del post_data["text"]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://oauth.reddit.com/api/submit",
            headers={"Authorization": f"Bearer {token}", "User-Agent": "Kartavya/1.0"},
            data=post_data,
        )
        resp.raise_for_status()
        data = resp.json()
    url = data.get("json", {}).get("data", {}).get("url", "")
    post_id = data.get("json", {}).get("data", {}).get("id", "")
    return {"platform_post_id": post_id, "platform_url": url or None}


@_guarded
async def publish_to_whatsapp_business(account: dict, text: str, media_urls: list = None) -> dict:
    """Send a template message via WhatsApp Business Cloud API."""
    token = account["access_token"]
    phone_number_id = account.get("page_id") or account.get("account_id")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://graph.facebook.com/v21.0/{phone_number_id}/messages",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "messaging_product": "whatsapp",
                "type": "text",
                "text": {"body": text},
                "to": account.get("metadata", {}).get("broadcast_list", ""),
            },
        )
        resp.raise_for_status()
        data = resp.json()
    msg_id = data.get("messages", [{}])[0].get("id", "")
    return {"platform_post_id": msg_id, "platform_url": None}


# ── Queue processor ───────────────────────────────────────

async def _charge_for_publish(queue_id: str, item, platform: str, result: dict) -> dict:
    """Bill one completed publish. Called only after the post is live.

    `item` is the queue row — an asyncpg Record, which supports `.get()` the
    same way a dict does.

    Returns what to merge into the publish result. NEVER raises, and never
    reports failure back to `publish_content`, because by the time this runs the
    post is public and not reliably retractable. A queue row marked 'failed'
    over a billing problem would be retried and would post the same thing twice
    — which is a worse outcome for the customer than an uncollected credit, and
    unlike the credit it cannot be put right afterwards.

    Anything that goes wrong here is therefore logged at ERROR with the org, the
    queue id and the platform post id, which is everything needed to reconcile
    it by hand.
    """
    if result.get("suppressed"):
        # OUTBOUND_MODE=dry. No external call was made, so nothing was billed to
        # us and nothing is billed on. This is also what keeps the whole test
        # suite from writing ledger rows.
        return {"credits_charged": 0}

    org_id = item.get("client_org_id")
    if not org_id:
        # hub_clients.org_id is NOT NULL and the SELECT inner-joins it, so this
        # is unreachable rather than a case to handle. Logged instead of
        # ignored, because if it ever fires the join shape has changed.
        log.error("Publish %s billed nothing: no org on the queue row", queue_id)
        return {"credits_charged": 0}

    price_kind = _PAID_PLATFORMS.get(platform, _FREE_PLATFORM_PRICE)

    try:
        receipt = await credits.spend_standalone(
            org_id=str(org_id),
            user_id=item.get("created_by"),
            kind="channel",
            ref_id=price_kind,
            idempotency_key=f"publish:{queue_id}",
            description=f"Published to {platform}",
        )
        return {"credits_charged": receipt.credits}
    except credits.CreditError as exc:
        # Only reachable for WhatsApp: every other platform is priced at 0, and
        # a 0-credit spend has nothing to be short of. An org one credit short
        # of a send that already went out is a debt, and this line is the record
        # of it.
        log.error(
            "Publish %s to %s (post %s) went out but could not be billed to org "
            "%s: %s",
            queue_id, platform, result.get("platform_post_id"), org_id,
            getattr(exc, "detail", exc),
        )
        return {"credits_charged": 0, "credit_error": getattr(exc, "code", "credit_refused")}
    except Exception as exc:      # pragma: no cover — defence in depth
        log.error("Publish %s billing failed for org %s: %s", queue_id, org_id, exc)
        return {"credits_charged": 0, "credit_error": "billing_unavailable"}


async def publish_content(queue_id: str) -> dict:
    """Execute a publish from the queue."""
    pool = await get_pool()

    # `cl.org_id` is the whole plumbing change that makes this path billable.
    # It comes from hub_clients and not from hub_content_items, which has no
    # org_id column at all — the queue row's own client_id is the only route to
    # an org, and hub_clients.org_id is NOT NULL, so exactly one org owns this
    # publish. Aliased rather than bare in case hub_publish_queue ever gains an
    # org_id of its own: `q.*` and `cl.org_id` would then collide silently.
    # `q.created_by` already arrives through `q.*` and is who gets billed.
    item = await pool.fetchrow(
        "SELECT q.*, c.body, c.title, c.media_urls, c.hashtags, "
        "sa.platform, sa.access_token, sa.refresh_token, sa.token_expires_at, "
        "sa.page_id, sa.account_id, sa.metadata as acct_meta, "
        "cl.org_id AS client_org_id "
        "FROM staging.hub_publish_queue q "
        "JOIN staging.hub_content_items c ON c.id = q.content_id "
        "JOIN staging.hub_social_accounts sa ON sa.id = q.social_account_id "
        "JOIN staging.hub_clients cl ON cl.id = q.client_id "
        "WHERE q.id=$1::uuid",
        queue_id,
    )
    if not item:
        return {"error": "Queue item not found"}

    await pool.execute(
        "UPDATE staging.hub_publish_queue SET status='publishing' WHERE id=$1::uuid",
        queue_id,
    )

    text = item["body"] or item["title"] or ""
    if item["hashtags"]:
        text += "\n\n" + " ".join(f"#{h}" for h in item["hashtags"])

    media = item["media_urls"] or []
    # `item` came from a JOIN, so its tokens are still ciphertext. This line was
    # `dict(item)` and that was the whole bug — see `with_plain_tokens`.
    account = with_plain_tokens(item)

    account = await _refresh_token_if_needed(account)

    if account.get("_token_expired"):
        await pool.execute(
            "UPDATE staging.hub_publish_queue SET status='failed', "
            "error_message='Token expired — please reconnect this social account', "
            "retry_count=retry_count+1 WHERE id=$1::uuid",
            queue_id,
        )
        return {"status": "failed", "error": f"Token expired for {item['platform']} account. Please reconnect."}

    try:
        platform = item["platform"]
        publishers = {
            "facebook": publish_to_facebook,
            "instagram": publish_to_instagram,
            "linkedin": publish_to_linkedin,
            "google_business": publish_to_google_business,
            "youtube": publish_to_youtube,
            "pinterest": publish_to_pinterest,
            "threads": publish_to_threads,
            "telegram": publish_to_telegram,
            "tiktok": publish_to_tiktok,
            "reddit": publish_to_reddit,
            "whatsapp_business": publish_to_whatsapp_business,
        }
        publisher = publishers.get(platform)
        if not publisher:
            raise ValueError(f"Unsupported platform: {platform}")
        result = await publisher(account, text, media)

        now = datetime.now(timezone.utc)
        await pool.execute(
            "UPDATE staging.hub_publish_queue SET "
            "status='published', platform_post_id=$1, platform_url=$2, published_at=$3 "
            "WHERE id=$4::uuid",
            result.get("platform_post_id"), result.get("platform_url"), now, queue_id,
        )

        await pool.execute(
            "UPDATE staging.hub_content_items SET "
            "status='published', published_at=$1, published_url=$2, published_platform_id=$3 "
            "WHERE id=$4::uuid",
            now, result.get("platform_url"), result.get("platform_post_id"), item["content_id"],
        )

        charge = await _charge_for_publish(queue_id, item, platform, result)
        return {"status": "published", **result, **charge}

    except Exception as exc:
        log.error("Publish failed for queue %s: %s", queue_id, exc)
        await pool.execute(
            "UPDATE staging.hub_publish_queue SET "
            "status='failed', error_message=$1, retry_count=retry_count+1 "
            "WHERE id=$2::uuid",
            str(exc)[:500], queue_id,
        )
        return {"status": "failed", "error": str(exc)}


# ── The sweep ─────────────────────────────────────────────
#
# WHAT THIS REPLACES, and why the two halves of it are not the same kind of
# thing. The whole function used to be:
#
#     SELECT id FROM staging.hub_publish_queue
#      WHERE status='scheduled' AND scheduled_for <= NOW()
#      ORDER BY scheduled_for LIMIT 10
#
# called by exactly one thing: Railway's `cron-daily` at `15 1 * * *`. So a post
# scheduled for 10:00 went out at about 01:15 the following night — roughly
# fifteen hours late — and the eleventh due post waited another twenty-four
# hours behind the same ten-row ceiling. Nothing said either had happened. The
# queue row read 'published', the cron answered 200, and the only person who
# could tell was the one refreshing the client's Instagram at ten past ten.
#
# THE FREQUENCY IS A BUG. A schedule that means "some time after the next
# nightly run" is not a schedule, and there is no volume question inside it.
# What this file can do about it is make a fifteen-minute sweep SAFE, which is
# what `_claim_for_publish` below is for; arming the schedule is a Railway
# change and is written down in `routers/scheduler.run_publish` rather than
# guessed at here.
#
# THE CAP IS A SETTING, and the owner's: "aekam can amend this as needs or
# requested by org." So it is per-organisation, it lives where the other
# per-org operational facts already live — `staging.organisations.settings`,
# the jsonb column that already carries `lead_capture_email` and
# `lead_capture_client_id` — and it needs no new table and no migration.
#
# AND WHEN IT BITES IT SAYS SO. A cap that silently drops the tail of a sweep
# reads exactly like a sweep with nothing left to do, which is the disease this
# whole file is being treated for.

#: How many due posts ONE ORGANISATION may have taken off the queue in a single
#: sweep when Aekam has not given it a number of its own. Ten, unchanged from
#: the old global LIMIT — but ten per org per FIFTEEN MINUTES rather than ten
#: for the whole product per DAY, which is the same number meaning something
#: entirely different.
DEFAULT_BATCH_LIMIT = 10

#: The key inside `staging.organisations.settings` that holds an org's own
#: number. Aekam amends it there; nothing in the product writes it, because the
#: owner's sentence is that Aekam sets it "as needs or requested by org" and a
#: customer raising their own outbound ceiling is not what was asked for.
BATCH_LIMIT_KEY = "publish_batch_limit"

#: The most any single org may take in one sweep, whatever is in its settings.
#: A sweep is sequential and one publish is a network call — YouTube's is
#: allowed 120 seconds — so an org with a four-figure number would hold the
#: worker for hours and starve every other org on the tick. 200 per fifteen
#: minutes is 19,200 a day for one firm, which is far past anything this
#: product has ever been asked for; a clamp is logged loudly rather than
#: applied quietly, so raising this constant is the answer if it is ever hit.
MAX_BATCH_LIMIT = 200


def batch_limit_for(raw, who: str = "") -> int:
    """This org's per-sweep cap, from whatever `settings` actually held.

    PURE, and separated from the query that produces its argument for the same
    reason `scheduler.partial_failure` is: the loop around it only ever talks to
    a database, and the database is a MagicMock in every test in this repo, so a
    test driving the loop proves the loop ran rather than that it judged
    correctly.

    A SETTING NOBODY CAN TYPO INTO SILENCE. `settings->>'publish_batch_limit'`
    comes back as text and is written by a human editing jsonb, so `"ten"`,
    `""`, `0` and `-1` are all reachable. None of them may stop an org's
    publishing: this is a ceiling, and a broken ceiling that reads as zero would
    hold every scheduled post for that firm for ever while every log line said
    the sweep found nothing due. So anything unusable falls back to the default
    and says so.

    Casting in Python rather than in SQL is deliberate too — `(settings->>'k')::int`
    on `"ten"` raises out of the query and takes the whole sweep, every other
    org included, down with it.
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return DEFAULT_BATCH_LIMIT
    try:
        limit = int(str(raw).strip())
    except (TypeError, ValueError):
        log.warning(
            "Publish sweep: %s has %s=%r in organisations.settings, which is "
            "not a whole number — using the default of %d. Nothing is held "
            "back by this; the setting is simply ignored until it is corrected.",
            who or "an organisation", BATCH_LIMIT_KEY, raw, DEFAULT_BATCH_LIMIT,
        )
        return DEFAULT_BATCH_LIMIT

    if limit < 1:
        log.warning(
            "Publish sweep: %s has %s=%r, which would publish nothing, ever. "
            "A cap is a ceiling and not a switch — using the default of %d. To "
            "stop an org publishing, cancel its queued posts.",
            who or "an organisation", BATCH_LIMIT_KEY, raw, DEFAULT_BATCH_LIMIT,
        )
        return DEFAULT_BATCH_LIMIT

    if limit > MAX_BATCH_LIMIT:
        log.warning(
            "Publish sweep: %s asks for %d posts a sweep; taking %d, which is "
            "the most one org may hold a tick for. Raise MAX_BATCH_LIMIT if "
            "this is genuinely wanted.",
            who or "an organisation", limit, MAX_BATCH_LIMIT,
        )
        return MAX_BATCH_LIMIT

    return limit


def truncation_notice(who: str, due: int, allowed: int) -> str | None:
    """The sentence a truncated sweep must log, or None when the cap did not bite.

    PURE, same reason. The COUNT LEFT BEHIND is the whole point of it: a sweep
    that took ten of ten and a sweep that took ten of four hundred produce
    identical rows, identical results and an identical 200, and only this line
    tells them apart.

    `allowed` is what THE CAP let this sweep reach for, which is deliberately
    not the same as what it published. A row another overlapping tick had
    already claimed is not held back by the cap and is going out right now, so
    counting it here would report a queue backing up when it is not.
    """
    left = due - allowed
    if left <= 0:
        return None
    return (
        f"Publish sweep: {who} had {due} post(s) due and this sweep's cap "
        f"allowed {allowed}. {left} WERE LEFT BEHIND and will go out on later "
        f"sweeps, oldest first. Raise '{BATCH_LIMIT_KEY}' in that "
        f"organisation's settings if they should go sooner."
    )


async def _claim_for_publish(pool, queue_id: str) -> bool:
    """Take one due row, or discover somebody else already has it.

    THE ONE THING A FIFTEEN-MINUTE SWEEP MUST NOT DO IS POST TWICE. Two ticks
    can overlap — a sweep that takes longer than the interval is ordinary, not
    exceptional, because one publish is a network call and YouTube's is allowed
    two minutes — and a post that goes out twice under the client's own name is
    the one outcome on this channel nobody can take back.

    `status='scheduled'` in the WHERE clause is the mutual exclusion, and it is
    the database's rather than ours. Under READ COMMITTED the second UPDATE
    blocks on the row lock, re-reads the row the first transaction committed,
    finds `status='publishing'` and matches nothing — so RETURNING gives NULL
    and this answers False. No advisory lock, no `SKIP LOCKED`, no in-process
    set of ids that a second Railway replica would not share.

    IT IS ALSO THE CANCEL BOUNDARY, which is why claiming happens one row at a
    time immediately before publishing rather than for the whole batch at once.
    `POST /publish/queue/{id}/cancel` only cancels a row that is still
    'scheduled'; claiming fifty rows up front would refuse Cancel on all fifty
    for as long as the batch ran, and the person cancelling the fiftieth post
    has every right to expect it to work.

    `publish_content` sets 'publishing' again a moment later. That is redundant
    on this path and load-bearing on the other one — `publish_now` calls it
    directly with no claim — so it stays.
    """
    return await pool.fetchval(
        "UPDATE staging.hub_publish_queue SET status='publishing' "
        "WHERE id=$1::uuid AND status='scheduled' RETURNING id::text",
        queue_id,
    ) is not None


async def sweep_scheduled_posts() -> dict:
    """One tick. Every organisation with something due, up to its own cap.

    Returns the publish results AND what the sweep did, because those are two
    different questions and only the first used to be answerable. `left_behind`
    is the number this tick could not take.
    """
    pool = await get_pool()

    # ONE ROW PER ORGANISATION, not one per queue item. The plan has to be
    # per-org because the cap is, and reading every due id to group them in
    # Python would put an unbounded queue in memory to answer a question
    # `count(*)` answers. `cl.org_id` is the only route from a queue row to an
    # org — `hub_publish_queue` has no org_id of its own and
    # `hub_clients.org_id` is NOT NULL — and it is the same join
    # `publish_content` bills through.
    #
    # The settings key is BOUND rather than interpolated, and cast rather than
    # left bare: `->>` is overloaded for jsonb and json, so an untyped $1 is an
    # ambiguous parameter expression, and PgBouncer turns that into an instant
    # 500 rather than a parse error anybody can read.
    plan = await pool.fetch(
        "SELECT cl.org_id::text AS org_id, "
        "       o.name AS org_name, "
        "       count(*)::int AS due, "
        "       o.settings->>$1::text AS raw_limit "
        "  FROM staging.hub_publish_queue q "
        "  JOIN staging.hub_clients cl ON cl.id = q.client_id "
        "  JOIN staging.organisations o ON o.id = cl.org_id "
        " WHERE q.status='scheduled' AND q.scheduled_for <= NOW() "
        " GROUP BY cl.org_id, o.name, o.settings->>$1::text "
        " ORDER BY cl.org_id",
        BATCH_LIMIT_KEY,
    )

    results: list = []
    left_behind = 0
    taken_total = 0

    for org in plan:
        # The org's NAME in every sentence below. These are log lines and not a
        # screen, but the rule is the same rule and a uuid in a 03:00 log line
        # is one more lookup for whoever is reading it.
        who = org["org_name"] or "an organisation"
        due = org["due"]
        limit = batch_limit_for(org["raw_limit"], who)

        # OLDEST FIRST, and `q.id` after `q.scheduled_for` so the order is
        # total. Two posts scheduled for the same minute would otherwise come
        # back in whatever order the planner liked, and the one at the tail of
        # a truncated sweep could be a different row every tick — which is how
        # a post gets starved for ever behind a cap it keeps just missing.
        candidates = await pool.fetch(
            "SELECT q.id::text AS id "
            "  FROM staging.hub_publish_queue q "
            "  JOIN staging.hub_clients cl ON cl.id = q.client_id "
            " WHERE q.status='scheduled' AND q.scheduled_for <= NOW() "
            "   AND cl.org_id = $1::uuid "
            " ORDER BY q.scheduled_for, q.id "
            " LIMIT $2::int",
            org["org_id"], limit,
        )

        taken = 0
        for row in candidates:
            queue_id = str(row["id"])
            if not await _claim_for_publish(pool, queue_id):
                # An overlapping tick got there first, or somebody cancelled it
                # between the SELECT and here. Neither is an error and neither
                # is this sweep's row to publish.
                log.info(
                    "Publish sweep: queue row %s was already taken or "
                    "cancelled — skipped, not published.", queue_id,
                )
                continue
            results.append(await publish_content(queue_id))
            taken += 1

        taken_total += taken
        # Against `len(candidates)` and NOT against `taken`: see
        # `truncation_notice`. What the cap held back is the number the person
        # reading this can do something about.
        notice = truncation_notice(who, due, len(candidates))
        if notice:
            # WARNING, not INFO. Silent truncation is what made a daily
            # ten-post ceiling look like a product with nothing to publish.
            log.warning("%s", notice)
            left_behind += due - len(candidates)

    return {
        "results": results,
        "organisations": len(plan),
        "taken": taken_total,
        "left_behind": left_behind,
    }


async def process_scheduled_posts():
    """Process the posts that are due. Called by a cron/scheduler.

    Kept as the list-returning shape both cron doors already expect —
    `scheduler.run_publish` counts failures out of it and
    `hub_publish.dispatch_scheduled_posts` counts published and failed. The
    sweep's own summary is `sweep_scheduled_posts`.
    """
    return (await sweep_scheduled_posts())["results"]
