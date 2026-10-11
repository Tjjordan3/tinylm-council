"""Profile-aware prompt builders for council stages."""

from __future__ import annotations

from typing import Any, Dict, List


STAGE_LIMITS = {
    "tiny": {
        "stage1": {"max_tokens": 400, "temperature": 0.7},
        "stage2": {"max_tokens": 128, "temperature": 0.2},
        "debate": {"max_tokens": 250, "temperature": 0.4},
        "stage3": {"max_tokens": 700, "temperature": 0.5},
        "title": {"max_tokens": 15, "temperature": 0.3},
    },
    "standard": {
        "stage1": {"max_tokens": None, "temperature": None},
        "stage2": {"max_tokens": None, "temperature": None},
        "debate": {"max_tokens": None, "temperature": None},
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


def build_stage1_messages(
    user_query: str, profile: str, web_context: str = ""
) -> List[Dict[str, str]]:
    web_block = format_web_context_block(web_context)
    user_content = f"{web_block}Question: {user_query}" if web_block else user_query

    if profile == "tiny":
        return [
            {
                "role": "system",
                "content": "Answer in 2-5 sentences. Be direct and accurate.",
            },
            {"role": "user", "content": user_content},
        ]
    return [{"role": "user", "content": user_content}]


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
