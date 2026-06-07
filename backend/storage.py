"""JSON-based storage for conversations."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "conversations"


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str) -> Path:
    return DATA_DIR / f"{conversation_id}.json"


def create_conversation(conversation_id: str) -> Dict[str, Any]:
    ensure_data_dir()
    conversation = {
        "id": conversation_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "title": "New Conversation",
        "messages": [],
    }
    path = get_conversation_path(conversation_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(conversation, f, indent=2)
    return conversation


def get_conversation(conversation_id: str) -> Optional[Dict[str, Any]]:
    path = get_conversation_path(conversation_id)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_conversation(conversation: Dict[str, Any]) -> None:
    ensure_data_dir()
    path = get_conversation_path(conversation["id"])
    with open(path, "w", encoding="utf-8") as f:
        json.dump(conversation, f, indent=2)


def list_conversations() -> List[Dict[str, Any]]:
    ensure_data_dir()
    conversations = []
    for filename in os.listdir(DATA_DIR):
        if filename.endswith(".json"):
            path = DATA_DIR / filename
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            conversations.append(
                {
                    "id": data["id"],
                    "created_at": data["created_at"],
                    "title": data.get("title", "New Conversation"),
                    "message_count": len(data["messages"]),
                }
            )
    conversations.sort(key=lambda x: x["created_at"], reverse=True)
    return conversations


def add_user_message(conversation_id: str, content: str) -> None:
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")
    conversation["messages"].append({"role": "user", "content": content})
    save_conversation(conversation)


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any],
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")
    message = {
        "role": "assistant",
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3,
    }
    if metadata:
        message["metadata"] = metadata
    conversation["messages"].append(message)
    save_conversation(conversation)


def update_conversation_title(conversation_id: str, title: str) -> None:
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")
    conversation["title"] = title
    save_conversation(conversation)
