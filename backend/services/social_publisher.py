"""
social_publisher.py — Post content to social platforms via OAuth APIs.
Supports Facebook/Instagram (Meta Graph API), LinkedIn, Google Business Profile.
Includes token refresh for Meta and LinkedIn.
"""
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx

from db import get_pool
from services.encryption import decrypt, encrypt
from outbound import suppressed

log = logging.getLogger(__name__)


def _guarded(fn):
    """Suppress a publish when OUTBOUND_MODE=dry.

    Applied to every publish_to_* entry point rather than to their callers, so
    a new platform or a new caller is covered without anyone remembering to.

    These post through per-client OAuth tokens to a customer's own audience.
    A wrong post is public and not reliably retractable, which is why this is
    the one channel guarded at every entry rather than at a dispatcher.
    """
    async def _wrapper(account: dict, text: str, media_urls: list = None) -> dict:
        platform = fn.__name__.replace("publish_to_", "")
        target = account.get("account_name") or account.get("page_id") or account.get("account_id") or ""
        if suppressed(f"social:{platform}", str(target), (text or "")[:80]):
            return {"platform_post_id": None, "platform_url": None, "suppressed": True}
        return await fn(account, text, media_urls)

    _wrapper.__name__ = fn.__name__
    _wrapper.__doc__ = fn.__doc__
    return _wrapper


async def _get_account(account_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM staging.hub_social_accounts WHERE id=$1::uuid AND is_active=TRUE",
        account_id,
    )
    if not row:
        return None
    # Decrypt at the point of read, so every caller downstream — refresh,
    # publish, the platform SDKs — keeps seeing a plain token and needs no
    # knowledge of how the column is stored. `decrypt` passes unmarked values
    # through, so rows written before encryption keep working.
    acct = dict(row)
    for col in ("access_token", "refresh_token"):
        if acct.get(col):
            acct[col] = decrypt(acct[col])
    return acct


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


@_guarded
async def publish_to_linkedin(account: dict, text: str, media_urls: list = None) -> dict:
    """Post to LinkedIn (personal or organization)."""
    token = account["access_token"]
    author = account.get("account_id", "")

    if author.startswith("urn:"):
        author_urn = author
    else:
        author_urn = f"urn:li:person:{author}"

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

async def publish_content(queue_id: str) -> dict:
    """Execute a publish from the queue."""
    pool = await get_pool()

    item = await pool.fetchrow(
        "SELECT q.*, c.body, c.title, c.media_urls, c.hashtags, "
        "sa.platform, sa.access_token, sa.refresh_token, sa.token_expires_at, "
        "sa.page_id, sa.account_id, sa.metadata as acct_meta "
        "FROM staging.hub_publish_queue q "
        "JOIN staging.hub_content_items c ON c.id = q.content_id "
        "JOIN staging.hub_social_accounts sa ON sa.id = q.social_account_id "
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
    account = dict(item)

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

        return {"status": "published", **result}

    except Exception as exc:
        log.error("Publish failed for queue %s: %s", queue_id, exc)
        await pool.execute(
            "UPDATE staging.hub_publish_queue SET "
            "status='failed', error_message=$1, retry_count=retry_count+1 "
            "WHERE id=$2::uuid",
            str(exc)[:500], queue_id,
        )
        return {"status": "failed", "error": str(exc)}


async def process_scheduled_posts():
    """Process all posts that are due for publishing. Called by a cron/scheduler."""
    pool = await get_pool()
    due = await pool.fetch(
        "SELECT id FROM staging.hub_publish_queue "
        "WHERE status='scheduled' AND scheduled_for <= NOW() "
        "ORDER BY scheduled_for LIMIT 10"
    )
    results = []
    for row in due:
        result = await publish_content(str(row["id"]))
        results.append(result)
    return results
