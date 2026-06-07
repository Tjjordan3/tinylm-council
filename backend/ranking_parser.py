"""Parse peer ranking text from council members."""

from __future__ import annotations

import re
from typing import List, Tuple


def _labels_from_letters(letters: List[str]) -> List[str]:
    return [f"Response {letter.strip().upper()}" for letter in letters if letter.strip()]


def parse_ranking_from_text(ranking_text: str, available_labels: List[str] | None = None) -> List[str]:
    if not ranking_text:
        return []

    text = ranking_text.strip()

    if "FINAL RANKING:" in text:
        parts = text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            numbered_matches = re.findall(r"\d+\.\s*Response [A-Z]", ranking_section)
            if numbered_matches:
                return [re.search(r"Response [A-Z]", match).group() for match in numbered_matches]
            matches = re.findall(r"Response [A-Z]", ranking_section)
            if matches:
                return matches

    rank_match = re.search(r"RANK:\s*(.+)", text, re.IGNORECASE)
    if rank_match:
        rank_part = rank_match.group(1).split("\n")[0].strip()
        if "Response" in rank_part:
            labels = re.findall(r"Response [A-Z]", rank_part)
            if labels:
                return labels
        letters = [part.strip() for part in rank_part.split(",")]
        labels = _labels_from_letters(letters)
        if labels:
            return labels

    for line in reversed(text.splitlines()):
        if "Response" in line and "," in line:
            labels = re.findall(r"Response [A-Z]", line)
            if labels:
                return labels
        if re.match(r"^[A-Z](,\s*[A-Z])+$", line.strip()):
            labels = _labels_from_letters(line.strip().split(","))
            if labels:
                return labels

    matches = re.findall(r"Response [A-Z]", text)
    if matches:
        return matches

    return []


def parse_ranking_with_fallback(
    ranking_text: str,
    available_labels: List[str],
) -> Tuple[List[str], bool]:
    parsed = parse_ranking_from_text(ranking_text, available_labels)
    if parsed:
        valid = [label for label in parsed if label in available_labels]
        if valid:
            unique = []
            for label in valid:
                if label not in unique:
                    unique.append(label)
            return unique, False

    return list(available_labels), True
