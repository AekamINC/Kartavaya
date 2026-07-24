"""
chunker.py — Smart content chunking for RAG ingestion.
Produces structured chunks with metadata for tasks, documents, and comment threads.
"""
import re
from typing import Any


def chunk_task(task_data: dict) -> list[dict]:
    """Chunk a task into a structured knowledge chunk.

    Combines title, description, status, assignee, and comments into
    a single rich chunk (or multiple if comments are long).

    Args:
        task_data: dict with keys like title, description, status,
                   assignee_name, comments (list of dicts with author, text, created_at).

    Returns:
        List of chunk dicts with 'content' and 'metadata'.
    """
    title = task_data.get("title", "")
    desc = task_data.get("description", "") or ""
    status = task_data.get("status", "")
    assignee = task_data.get("assignee_name", "")
    priority = task_data.get("priority", "")
    task_id = task_data.get("id", "")

    header = f"Task: {title}"
    if status:
        header += f" | Status: {status}"
    if assignee:
        header += f" | Assignee: {assignee}"
    if priority:
        header += f" | Priority: {priority}"

    body_parts = [header]
    if desc:
        body_parts.append(f"Description: {desc}")

    comments = task_data.get("comments", [])
    comment_text = ""
    if comments:
        comment_lines = []
        for c in comments:
            author = c.get("author", "Unknown")
            text = c.get("text", "")
            comment_lines.append(f"  {author}: {text}")
        comment_text = "Comments:\n" + "\n".join(comment_lines)

    metadata = {
        "source_type": "task",
        "source_id": str(task_id),
        "title": title,
        "status": status,
        "assignee": assignee,
    }

    # If everything fits in one chunk (~500 words), keep it together
    full_content = "\n".join(body_parts)
    if comment_text:
        full_content += "\n" + comment_text

    if len(full_content.split()) <= 500:
        return [{"content": full_content, "metadata": metadata}]

    # Split: main chunk + comment chunks
    chunks = [{"content": "\n".join(body_parts), "metadata": metadata}]
    if comment_text:
        # Split comments into ~400-word groups
        for group in _split_by_words(comment_text, 400):
            chunks.append({
                "content": f"Task: {title}\n{group}",
                "metadata": {**metadata, "chunk_type": "comments"},
            })
    return chunks


def chunk_document(text: str, metadata: dict | None = None) -> list[dict]:
    """Chunk a document into paragraph-level pieces with header context.

    Detects markdown-style headers and carries the most recent header
    into each chunk for context.

    Args:
        text: Full document text.
        metadata: Base metadata dict to attach to each chunk.

    Returns:
        List of chunk dicts with 'content' and 'metadata'.
    """
    metadata = metadata or {}
    text = re.sub(r'\n{3,}', '\n\n', text.strip())
    if not text:
        return []

    # Split by paragraphs (double newline)
    paragraphs = re.split(r'\n\n+', text)

    chunks = []
    current_header = ""
    current_parts: list[str] = []
    current_len = 0

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # Detect headers (markdown # or ALL CAPS short lines)
        if re.match(r'^#{1,4}\s+', para) or (len(para.split()) <= 8 and para == para.upper() and len(para) > 3):
            # Flush current
            if current_parts:
                content = current_parts[0] if len(current_parts) == 1 else "\n\n".join(current_parts)
                chunks.append({
                    "content": content,
                    "metadata": {**metadata, "section_header": current_header},
                })
                current_parts = []
                current_len = 0
            current_header = para.lstrip("# ").strip()
            continue

        words = len(para.split())
        if current_len + words > 400 and current_parts:
            content = "\n\n".join(current_parts)
            if current_header:
                content = f"[{current_header}]\n{content}"
            chunks.append({
                "content": content,
                "metadata": {**metadata, "section_header": current_header},
            })
            current_parts = []
            current_len = 0

        current_parts.append(para)
        current_len += words

    # Flush remaining
    if current_parts:
        content = "\n\n".join(current_parts)
        if current_header:
            content = f"[{current_header}]\n{content}"
        chunks.append({
            "content": content,
            "metadata": {**metadata, "section_header": current_header},
        })

    return chunks


def chunk_comments(thread: list[dict]) -> list[dict]:
    """Chunk a comment thread into grouped chunks.

    Groups consecutive comments to maintain conversational context,
    splitting at ~400-word boundaries.

    Args:
        thread: List of dicts with 'author', 'text', 'created_at'.

    Returns:
        List of chunk dicts with 'content' and 'metadata'.
    """
    if not thread:
        return []

    chunks = []
    current_lines: list[str] = []
    current_len = 0
    thread_id = thread[0].get("thread_id", "")

    for comment in thread:
        author = comment.get("author", "Unknown")
        text = comment.get("text", "")
        created = comment.get("created_at", "")
        line = f"{author} ({created}): {text}" if created else f"{author}: {text}"
        words = len(line.split())

        if current_len + words > 400 and current_lines:
            chunks.append({
                "content": "\n".join(current_lines),
                "metadata": {
                    "source_type": "comment_thread",
                    "thread_id": thread_id,
                    "message_count": len(current_lines),
                },
            })
            current_lines = []
            current_len = 0

        current_lines.append(line)
        current_len += words

    if current_lines:
        chunks.append({
            "content": "\n".join(current_lines),
            "metadata": {
                "source_type": "comment_thread",
                "thread_id": thread_id,
                "message_count": len(current_lines),
            },
        })

    return chunks


def _split_by_words(text: str, max_words: int) -> list[str]:
    """Split text into segments of approximately max_words."""
    words = text.split()
    segments = []
    for i in range(0, len(words), max_words):
        segments.append(" ".join(words[i:i + max_words]))
    return segments
