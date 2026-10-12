"""Persisted conversation attachments (text/code + images)."""

from __future__ import annotations

import base64
import json
import mimetypes
import re
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .context_utils import truncate_text
from .paths import attachments_dir
from .token_budget import budget_for, chars_for_tokens

MAX_TEXT_FILES_PER_TURN = 8
MAX_IMAGES_PER_TURN = 4
MAX_TEXT_FILE_BYTES = 256 * 1024
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_PACKED_TEXT_BYTES = 1024 * 1024

TEXT_EXTENSIONS = {
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".md",
    ".txt",
    ".json",
    ".toml",
    ".yaml",
    ".yml",
    ".rs",
    ".go",
    ".java",
    ".css",
    ".html",
    ".htm",
    ".sh",
    ".bash",
    ".sql",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".kt",
    ".scala",
    ".r",
    ".m",
    ".mm",
    ".vue",
    ".svelte",
    ".xml",
    ".ini",
    ".cfg",
    ".conf",
    ".env",
    ".gitignore",
    ".dockerfile",
    ".makefile",
    ".cmake",
    ".gradle",
    ".properties",
    ".csv",
    ".tsv",
    ".log",
}

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}

VISION_MODEL_HINTS = (
    "llava",
    "vision",
    "gpt-4o",
    "gpt-4.1",
    "gpt-4-turbo",
    "gemini",
    "claude-3",
    "claude-4",
    "claude-sonnet",
    "claude-opus",
    "claude-haiku",
    "qwen2-vl",
    "qwen2.5-vl",
    "qwen-vl",
    "pixtral",
    "phi-3-vision",
    "phi-4-multimodal",
    "moondream",
    "minicpm-v",
    "internvl",
    "cogvlm",
)


class AttachmentError(ValueError):
    """User-facing attachment validation error."""


def _safe_name(name: str) -> str:
    base = Path(name or "file").name
    cleaned = re.sub(r"[^\w.\- ()\[\]]+", "_", base).strip(" ._")
    return cleaned[:180] or "file"


def _extension(name: str) -> str:
    return Path(name or "").suffix.lower()


def _meta_path(conversation_id: str) -> Path:
    return attachments_dir(conversation_id) / "index.json"


def _load_index(conversation_id: str) -> Dict[str, Any]:
    path = _meta_path(conversation_id)
    if not path.exists():
        return {"attachments": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"attachments": []}
        data.setdefault("attachments", [])
        return data
    except (OSError, json.JSONDecodeError):
        return {"attachments": []}


def _save_index(conversation_id: str, data: Dict[str, Any]) -> None:
    path = _meta_path(conversation_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def list_attachments(conversation_id: str) -> List[Dict[str, Any]]:
    return list(_load_index(conversation_id).get("attachments") or [])


def get_attachment(conversation_id: str, attachment_id: str) -> Optional[Dict[str, Any]]:
    for item in list_attachments(conversation_id):
        if item.get("id") == attachment_id:
            return item
    return None


def attachment_file_path(conversation_id: str, meta: Dict[str, Any]) -> Path:
    return attachments_dir(conversation_id) / meta["stored_name"]


def delete_conversation_attachments(conversation_id: str) -> None:
    root = attachments_dir(conversation_id)
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)


def delete_attachments(conversation_id: str, attachment_ids: Sequence[str]) -> None:
    if not attachment_ids:
        return
    index = _load_index(conversation_id)
    keep: List[Dict[str, Any]] = []
    remove_ids = set(attachment_ids)
    for item in index.get("attachments") or []:
        if item.get("id") in remove_ids:
            path = attachment_file_path(conversation_id, item)
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        else:
            keep.append(item)
    index["attachments"] = keep
    if keep:
        _save_index(conversation_id, index)
    else:
        # Drop empty conversation attachment dir when possible
        delete_conversation_attachments(conversation_id)


def _detect_kind(filename: str, content_type: Optional[str]) -> str:
    ext = _extension(filename)
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ext in IMAGE_EXTENSIONS or ctype in IMAGE_MIME_TYPES:
        return "image"
    if ext in TEXT_EXTENSIONS or ctype.startswith("text/") or ctype in (
        "application/json",
        "application/javascript",
        "application/typescript",
        "application/x-yaml",
        "application/toml",
        "application/xml",
    ):
        return "text"
    raise AttachmentError(
        f"Unsupported file type for '{filename}'. "
        "Attach text/code files or images (png/jpeg/webp/gif)."
    )


def save_upload(
    conversation_id: str,
    filename: str,
    data: bytes,
    content_type: Optional[str] = None,
) -> Dict[str, Any]:
    if not data:
        raise AttachmentError("Empty file.")
    kind = _detect_kind(filename, content_type)
    if kind == "text":
        if len(data) > MAX_TEXT_FILE_BYTES:
            raise AttachmentError(
                f"'{filename}' exceeds {MAX_TEXT_FILE_BYTES // 1024} KB text limit."
            )
        # Ensure decodable as text
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise AttachmentError(f"'{filename}' is not valid UTF-8 text.") from exc
    else:
        if len(data) > MAX_IMAGE_BYTES:
            raise AttachmentError(
                f"'{filename}' exceeds {MAX_IMAGE_BYTES // (1024 * 1024)} MB image limit."
            )

    index = _load_index(conversation_id)
    existing = index.get("attachments") or []

    attachment_id = uuid.uuid4().hex[:12]
    safe = _safe_name(filename)
    stored_name = f"{attachment_id}_{safe}"
    dest = attachments_dir(conversation_id) / stored_name
    dest.write_bytes(data)

    mime = (content_type or "").split(";")[0].strip().lower()
    if not mime:
        guessed, _ = mimetypes.guess_type(safe)
        mime = guessed or ("text/plain" if kind == "text" else "application/octet-stream")

    meta = {
        "id": attachment_id,
        "name": safe,
        "stored_name": stored_name,
        "size": len(data),
        "kind": kind,
        "content_type": mime,
    }
    existing.append(meta)
    index["attachments"] = existing
    _save_index(conversation_id, index)
    return {
        "id": attachment_id,
        "name": safe,
        "size": len(data),
        "kind": kind,
        "content_type": mime,
    }


def resolve_attachment_metas(
    conversation_id: str, attachment_ids: Sequence[str]
) -> List[Dict[str, Any]]:
    if not attachment_ids:
        return []
    if len(attachment_ids) > MAX_TEXT_FILES_PER_TURN + MAX_IMAGES_PER_TURN:
        raise AttachmentError("Too many attachments on one message.")
    by_id = {a["id"]: a for a in list_attachments(conversation_id)}
    resolved = []
    missing = []
    for aid in attachment_ids:
        item = by_id.get(aid)
        if item is None:
            missing.append(aid)
        else:
            resolved.append(item)
    if missing:
        raise AttachmentError(f"Unknown attachment id(s): {', '.join(missing)}")
    text_count = sum(1 for m in resolved if m.get("kind") == "text")
    image_count = sum(1 for m in resolved if m.get("kind") == "image")
    if text_count > MAX_TEXT_FILES_PER_TURN:
        raise AttachmentError(f"At most {MAX_TEXT_FILES_PER_TURN} text/code files per message.")
    if image_count > MAX_IMAGES_PER_TURN:
        raise AttachmentError(f"At most {MAX_IMAGES_PER_TURN} images per message.")
    return resolved


def read_text_attachment(conversation_id: str, meta: Dict[str, Any]) -> str:
    path = attachment_file_path(conversation_id, meta)
    return path.read_text(encoding="utf-8", errors="replace")


def build_attachments_context(
    conversation_id: str,
    attachment_ids: Sequence[str],
    profile: str,
) -> Tuple[str, List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Return (text_block, text_metas, image_metas) packed under profile budget."""
    metas = resolve_attachment_metas(conversation_id, attachment_ids)
    text_metas = [m for m in metas if m.get("kind") == "text"]
    image_metas = [m for m in metas if m.get("kind") == "image"]

    token_budget = budget_for(profile, "attachments")
    char_budget = min(chars_for_tokens(token_budget), MAX_PACKED_TEXT_BYTES)
    if not text_metas:
        names = ", ".join(m.get("name") or "image" for m in image_metas)
        note = f"Attached images: {names}." if image_metas else ""
        return note, text_metas, image_metas

    per = max(120, char_budget // max(len(text_metas), 1))
    parts: List[str] = []
    used = 0
    for meta in text_metas:
        name = meta.get("name") or "file"
        body = read_text_attachment(conversation_id, meta)
        chunk = truncate_text(body, per)
        block = f"### {name}\n```\n{chunk}\n```"
        if used + len(block) > char_budget:
            remaining = max(0, char_budget - used - 40)
            if remaining < 80:
                parts.append(f"### {name}\n[truncated: budget full]")
                break
            chunk = truncate_text(body, remaining)
            parts.append(f"### {name}\n```\n{chunk}\n```")
            break
        parts.append(block)
        used += len(block) + 2

    text_block = "Attached files:\n\n" + "\n\n".join(parts)
    if image_metas:
        names = ", ".join(m.get("name") or "image" for m in image_metas)
        text_block += f"\n\nAttached images (see vision input if supported): {names}."
    return truncate_text(text_block, char_budget + 200), text_metas, image_metas


def image_data_url(conversation_id: str, meta: Dict[str, Any]) -> str:
    path = attachment_file_path(conversation_id, meta)
    raw = path.read_bytes()
    mime = meta.get("content_type") or "image/png"
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:{mime};base64,{b64}"


def model_supports_vision(model: str, vision_capable: Optional[bool] = None) -> bool:
    if vision_capable is True:
        return True
    if vision_capable is False:
        return False
    lowered = (model or "").lower()
    return any(hint in lowered for hint in VISION_MODEL_HINTS)


def public_meta(meta: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": meta.get("id"),
        "name": meta.get("name"),
        "size": meta.get("size"),
        "kind": meta.get("kind"),
        "content_type": meta.get("content_type"),
    }
