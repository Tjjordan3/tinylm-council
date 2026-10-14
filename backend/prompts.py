"""Profile-aware prompt builders for council stages."""

from __future__ import annotations

from typing import Any, Dict, List, Optional


STAGE_LIMITS = {
    "tiny": {
        "stage1": {"max_tokens": 400, "temperature": 0.7},
        "stage2": {"max_tokens": 128, "temperature": 0.2},
        "debate": {"max_tokens": 250, "temperature": 0.4},
        "draft": {"max_tokens": 280, "temperature": 0.4},
        "draft_editor": {"max_tokens": 400, "temperature": 0.3},
        "stage3": {"max_tokens": 700, "temperature": 0.5},
        "title": {"max_tokens": 15, "temperature": 0.3},
    },
    "standard": {
        "stage1": {"max_tokens": None, "temperature": None},
        "stage2": {"max_tokens": None, "temperature": None},
        "debate": {"max_tokens": None, "temperature": None},
        "draft": {"max_tokens": None, "temperature": None},
        "draft_editor": {"max_tokens": None, "temperature": None},
        "stage3": {"max_tokens": None, "temperature": None},
        "title": {"max_tokens": 30, "temperature": 0.3},
    },
}


def get_stage_limits(profile: str, stage: str) -> Dict[str, Any]:
    profile_key = profile if profile in STAGE_LIMITS else "standard"
    return STAGE_LIMITS[profile_key].get(stage, {})


def format_web_context_block(web_context: str) -> str:
    if not web_context or not web_context.strip():
        return ""
    return (
        "Web search results (may be incomplete or outdated):\n"
        f"{web_context.strip()}\n\n"
        "Use web results if relevant; do not invent sources.\n\n"
    )


def format_attachments_block(attachments_context: str) -> str:
    if not attachments_context or not attachments_context.strip():
        return ""
    return f"{attachments_context.strip()}\n\n"


def build_stage1_user_text(
    user_query: str,
    web_context: str = "",
    attachments_context: str = "",
) -> str:
    parts = []
    web_block = format_web_context_block(web_context)
    if web_block:
        parts.append(web_block.rstrip())
    attach_block = format_attachments_block(attachments_context)
    if attach_block:
        parts.append(attach_block.rstrip())
    parts.append(f"Question: {user_query}" if parts else user_query)
    return "\n\n".join(parts)


def _stage1_system_nudge(profile: str, deliberation_mode: str = "rank", *, vision: bool = False) -> str:
    mode = (deliberation_mode or "rank").strip().lower()
    if profile == "tiny":
        if mode == "draft":
            base = (
                "Write a solid first draft answer in 2-5 sentences. "
                "Be direct and accurate; peers will revise a shared draft next."
            )
        else:
            base = "Answer in 2-5 sentences. Be direct and accurate."
        if vision:
            base += " Use attached images when relevant."
        return base
    if mode == "draft":
        base = (
            "Write a clear first-draft answer suitable for collaborative editing. "
            "Be accurate and structured; peers will revise a shared draft next."
        )
        if vision:
            base += " Use attached images when relevant."
        return base
    if vision:
        return "Be direct and accurate. Use attached images when relevant."
    return ""


def build_stage1_messages(
    user_query: str,
    profile: str,
    web_context: str = "",
    attachments_context: str = "",
    deliberation_mode: str = "rank",
) -> List[dict]:
    user_content = build_stage1_user_text(
        user_query, web_context=web_context, attachments_context=attachments_context
    )
    nudge = _stage1_system_nudge(profile, deliberation_mode)
    if nudge:
        return [
            {"role": "system", "content": nudge},
            {"role": "user", "content": user_content},
        ]
    return [{"role": "user", "content": user_content}]


def build_stage1_messages_with_images(
    user_query: str,
    profile: str,
    web_context: str = "",
    attachments_context: str = "",
    image_data_urls: Optional[List[str]] = None,
    deliberation_mode: str = "rank",
) -> List[dict]:
    """Stage 1 messages; when image_data_urls set, user content is multimodal parts."""
    text = build_stage1_user_text(
        user_query, web_context=web_context, attachments_context=attachments_context
    )
    urls = [u for u in (image_data_urls or []) if u]
    if not urls:
        return build_stage1_messages(
            user_query,
            profile,
            web_context=web_context,
            attachments_context=attachments_context,
            deliberation_mode=deliberation_mode,
        )

    user_content: List[dict] = [{"type": "text", "text": text}]
    for url in urls:
        user_content.append({"type": "image_url", "image_url": {"url": url}})

    messages: List[dict] = [{"role": "user", "content": user_content}]
    nudge = _stage1_system_nudge(profile, deliberation_mode, vision=True)
    if nudge:
        messages.insert(0, {"role": "system", "content": nudge})
    return messages


def build_stage2_prompt(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    labels: List[str],
    profile: str,
    web_context: str = "",
    shared_brief: str = "",
) -> str:
    if shared_brief and shared_brief.strip():
        responses_text = shared_brief.strip()
    else:
        responses_text = "\n\n".join(
            f"Response {label}:\n{result['response']}"
            for label, result in zip(labels, stage1_results)
        )
    label_list = ", ".join(f"Response {label}" for label in labels)
    example_rank = ",".join(reversed(labels)) if labels else "A,B"
    web_block = format_web_context_block(web_context)

    if profile == "tiny":
        return f"""Question: {user_query}

{web_block}{responses_text}

Rank these responses from best to worst ({label_list}).
Reply with ONE line only in this exact format:
RANK: {example_rank}"""

    return f"""You are evaluating different responses to the following question:

Question: {user_query}

{web_block}Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""


def build_debate_round_prompt(
    user_query: str,
    own_label: str,
    own_response: str,
    other_responses: List[Dict[str, str]],
    round_number: int,
    profile: str,
    web_context: str = "",
) -> str:
    """Build a rebuttal/revision prompt for one member in a debate round.

    other_responses items: {"label": "Response A", "text": "..."}.
    """
    others_text = "\n\n".join(
        f"{item['label']}:\n{item['text']}" for item in other_responses
    )
    web_block = format_web_context_block(web_context)

    if profile == "tiny":
        return f"""Question: {user_query}

{web_block}Your previous answer ({own_label}):
{own_response}

Other answers:
{others_text}

Debate round {round_number}. In 2-4 sentences: challenge any errors, concede what is right, and revise your answer if needed. Reply with your updated position only."""

    return f"""You are participating in a structured council debate (round {round_number}).

Original question: {user_query}

{web_block}Your previous answer (you are {own_label}):
{own_response}

Other anonymized answers:
{others_text}

Your task:
1. Point out mistakes or weak reasoning in the other answers where warranted.
2. Concede points that are clearly correct.
3. Revise or reinforce your own position.

Write a clear rebuttal and updated answer (a short paragraph or two). Do not reveal your identity beyond {own_label}."""


def summarize_debate_for_stage3(
    debate_rounds: List[Dict[str, Any]], profile: str
) -> str:
    """Compact debate transcript for the chairman prompt."""
    if not debate_rounds:
        return "(No debate rounds)"

    parts: List[str] = []
    for round_data in debate_rounds:
        round_num = round_data.get("round", "?")
        parts.append(f"--- Debate round {round_num} ---")
        for result in round_data.get("results") or []:
            name = result.get("display_name") or result.get("model") or "Member"
            text = (result.get("response") or "").strip()
            if result.get("error") and not text:
                text = f"(failed: {result['error']})"
            if profile == "tiny" and len(text) > 500:
                text = text[:497] + "..."
            parts.append(f"{name}:\n{text}")
    return "\n\n".join(parts)


def build_draft_critique_prompt(
    user_query: str,
    shared_draft: str,
    own_label: str,
    round_number: int,
    profile: str,
    web_context: str = "",
) -> str:
    """Ask a member to propose a revision against the current shared draft."""
    web_block = format_web_context_block(web_context)
    draft = (shared_draft or "").strip() or "(empty)"

    if profile == "tiny":
        return f"""Question: {user_query}

{web_block}Shared draft:
{draft}

You are {own_label}. Draft round {round_number}.
In 2-4 sentences, suggest concrete edits (fixes, missing points, clearer wording). Reply with your suggested revision of the full draft only."""

    return f"""You are contributing to a joint shared draft (round {round_number}). You are {own_label}.

Original question: {user_query}

{web_block}Current shared draft:
{draft}

Propose a revised version of the full draft:
- Fix errors and weak reasoning
- Add important missing points
- Keep what already works
- Do not mention your real model identity beyond {own_label}

Reply with the revised draft text only."""


def build_draft_editor_prompt(
    user_query: str,
    shared_draft: str,
    suggestions: List[Dict[str, str]],
    round_number: int,
    profile: str,
    web_context: str = "",
) -> str:
    """Ask the editor to merge peer suggestions into the next shared draft."""
    web_block = format_web_context_block(web_context)
    draft = (shared_draft or "").strip() or "(empty)"
    suggestions_text = "\n\n".join(
        f"{item.get('label') or 'Suggestion'}:\n{(item.get('text') or '').strip()}"
        for item in suggestions
        if (item.get("text") or "").strip()
    ) or "(No successful suggestions)"

    if profile == "tiny":
        return f"""Question: {user_query}

{web_block}Current shared draft:
{draft}

Peer suggestions:
{suggestions_text}

Draft round {round_number}. Merge the best suggestions into one improved draft. Reply with the full updated draft only."""

    return f"""You are the editor for a joint council draft (round {round_number}).

Original question: {user_query}

{web_block}Current shared draft:
{draft}

Anonymized peer revision suggestions:
{suggestions_text}

Merge the strongest improvements into one coherent next draft. Prefer accuracy and clarity over length. Reply with the full updated draft only (not a commentary)."""


def summarize_draft_for_stage3(
    shared_draft_rounds: List[Dict[str, Any]], profile: str
) -> str:
    """Compact joint-draft history for the chairman finalize prompt."""
    if not shared_draft_rounds:
        return "(No shared draft rounds)"

    parts: List[str] = []
    for round_data in shared_draft_rounds:
        round_num = round_data.get("round", "?")
        draft = (round_data.get("draft") or "").strip()
        if profile == "tiny" and len(draft) > 700:
            draft = draft[:697] + "..."
        parts.append(f"--- Draft after round {round_num} ---\n{draft or '(empty)'}")
        edits = round_data.get("edits") or []
        if edits and profile != "tiny":
            for edit in edits:
                name = edit.get("display_name") or edit.get("model") or "Member"
                text = (edit.get("response") or "").strip()
                if edit.get("error") and not text:
                    text = f"(failed: {edit['error']})"
                if len(text) > 400:
                    text = text[:397] + "..."
                parts.append(f"Suggestion from {name}:\n{text}")
    return "\n\n".join(parts)


def build_stage3_prompt(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_summary: str,
    profile: str,
    web_context: str = "",
    deliberation_mode: str = "rank",
) -> str:
    stage1_text = "\n\n".join(
        f"{result.get('display_name') or result['model']}:\n{result['response']}"
        for result in stage1_results
    )
    web_block = format_web_context_block(web_context)
    mode = (deliberation_mode or "rank").strip().lower()

    if mode == "quick":
        if profile == "tiny":
            return f"""You are the Chairman. Combine the best parts of these answers into one clear reply.

Question: {user_query}

{web_block}Answers:
{stage1_text}

Write one helpful final answer:"""

        return f"""You are the Chairman of an LLM Council. Multiple AI models provided responses to a user's question. Synthesize them into one final answer (no peer review was run).

Original Question: {user_query}

{web_block}STAGE 1 - Individual Responses:
{stage1_text}

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    if mode == "debate":
        if profile == "tiny":
            return f"""You are the Chairman. Combine the best parts of these answers and the debate into one clear reply.

Question: {user_query}

{web_block}Initial answers:
{stage1_text}

Debate:
{stage2_summary}

Write one helpful final consensus answer:"""

        return f"""You are the Chairman of an LLM Council. Multiple AI models gave initial answers, then debated each other in structured rounds.

Original Question: {user_query}

{web_block}STAGE 1 - Initial Responses:
{stage1_text}

STAGE 2 - Debate:
{stage2_summary}

Your task as Chairman is to synthesize a single, comprehensive, accurate consensus answer. Consider:
- The initial responses and their insights
- Points conceded or corrected during debate
- Remaining disagreements and which side is better supported

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    if mode == "draft":
        if profile == "tiny":
            return f"""You are the Chairman. Polish the shared draft into one clear final answer. Edit and finalize; do not rewrite from scratch unless the draft is empty or wrong.

Question: {user_query}

{web_block}Initial answers:
{stage1_text}

Shared draft history:
{stage2_summary}

Write the finalized answer:"""

        return f"""You are the Chairman of an LLM Council. Members wrote candidate answers, then iteratively improved one shared draft.

Original Question: {user_query}

{web_block}STAGE 1 - Initial Responses:
{stage1_text}

STAGE 2 - Shared draft rounds:
{stage2_summary}

Your task as Chairman is to edit and finalize the latest shared draft into one polished answer:
- Prefer the shared draft as the primary source; do not discard it to rewrite from scratch
- Fix remaining errors, tighten wording, and fill only critical gaps
- Use Stage 1 answers only to recover missing facts if the draft is incomplete

Provide the final polished answer:"""

    if profile == "tiny":
        return f"""You are the Chairman. Combine the best parts of these answers into one clear reply.

Question: {user_query}

{web_block}Answers:
{stage1_text}

Peer rankings:
{stage2_summary}

Write one helpful final answer:"""

    return f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: {user_query}

{web_block}STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_summary}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""


def build_title_prompt(user_query: str) -> str:
    return f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""
