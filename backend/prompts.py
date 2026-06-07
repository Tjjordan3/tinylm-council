"""Profile-aware prompt builders for council stages."""

from __future__ import annotations

from typing import Any, Dict, List


STAGE_LIMITS = {
    "tiny": {
        "stage1": {"max_tokens": 400, "temperature": 0.7},
        "stage2": {"max_tokens": 128, "temperature": 0.2},
        "stage3": {"max_tokens": 700, "temperature": 0.5},
        "title": {"max_tokens": 15, "temperature": 0.3},
    },
    "standard": {
        "stage1": {"max_tokens": None, "temperature": None},
        "stage2": {"max_tokens": None, "temperature": None},
        "stage3": {"max_tokens": None, "temperature": None},
        "title": {"max_tokens": 30, "temperature": 0.3},
    },
}


def get_stage_limits(profile: str, stage: str) -> Dict[str, Any]:
    profile_key = profile if profile in STAGE_LIMITS else "standard"
    return STAGE_LIMITS[profile_key].get(stage, {})


def build_stage1_messages(user_query: str, profile: str) -> List[Dict[str, str]]:
    if profile == "tiny":
        return [
            {
                "role": "system",
                "content": "Answer in 2-5 sentences. Be direct and accurate.",
            },
            {"role": "user", "content": user_query},
        ]
    return [{"role": "user", "content": user_query}]


def build_stage2_prompt(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    labels: List[str],
    profile: str,
) -> str:
    responses_text = "\n\n".join(
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, stage1_results)
    )
    label_list = ", ".join(f"Response {label}" for label in labels)
    example_rank = ",".join(reversed(labels)) if labels else "A,B"

    if profile == "tiny":
        return f"""Question: {user_query}

{responses_text}

Rank these responses from best to worst ({label_list}).
Reply with ONE line only in this exact format:
RANK: {example_rank}"""

    return f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

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


def build_stage3_prompt(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_summary: str,
    profile: str,
) -> str:
    stage1_text = "\n\n".join(
        f"{result.get('display_name') or result['model']}:\n{result['response']}"
        for result in stage1_results
    )

    if profile == "tiny":
        return f"""You are the Chairman. Combine the best parts of these answers into one clear reply.

Question: {user_query}

Answers:
{stage1_text}

Peer rankings:
{stage2_summary}

Write one helpful final answer:"""

    return f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: {user_query}

STAGE 1 - Individual Responses:
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
