from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/generate"


@dataclass(slots=True)
class CandidateDraft:
    hanzi: str
    pinyin: str
    definition: str
    example_zh: str
    base_score: float


def _post_to_ollama(model: str, prompt: str) -> dict[str, Any] | None:
    payload = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
        }
    ).encode("utf-8")
    request = Request(
        OLLAMA_ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=90) as response:
            body = response.read().decode("utf-8")
    except (TimeoutError, URLError):
        return None

    parsed = json.loads(body)
    message = parsed.get("response")

    if not message:
        return None

    return json.loads(message)


def enrich_candidates(
    candidates: list[CandidateDraft],
    model: str | None,
) -> list[dict[str, Any]]:
    fallback = [
        {
            "hanzi": candidate.hanzi,
            "meaning_vi": candidate.definition,
            "example_vi": "",
            "score": candidate.base_score,
            "tags": [],
        }
        for candidate in candidates
    ]

    if not model or not candidates:
        return fallback

    prompt = """
Bạn là trợ lý tạo flashcard tiếng Trung cho người học nói tiếng Việt.
Hãy trả về JSON object với khóa "items".
Mỗi item gồm:
- hanzi
- meaning_vi: nghĩa ngắn gọn, tự nhiên bằng tiếng Việt
- example_vi: dịch câu ví dụ sang tiếng Việt
- score: số từ 0 tới 1
- tags: mảng tag ngắn gọn

Dữ liệu đầu vào:
""".strip()
    prompt += "\n" + json.dumps(
        [
            {
                "hanzi": candidate.hanzi,
                "pinyin": candidate.pinyin,
                "definition": candidate.definition,
                "example_zh": candidate.example_zh,
                "base_score": candidate.base_score,
            }
            for candidate in candidates
        ],
        ensure_ascii=False,
    )

    response = _post_to_ollama(model, prompt)

    if not response or "items" not in response:
        return fallback

    items = response["items"]

    if not isinstance(items, list):
        return fallback

    by_hanzi = {
        item["hanzi"]: item
        for item in items
        if isinstance(item, dict) and isinstance(item.get("hanzi"), str)
    }

    enriched: list[dict[str, Any]] = []

    for fallback_item in fallback:
        candidate = by_hanzi.get(fallback_item["hanzi"])

        if not candidate:
            enriched.append(fallback_item)
            continue

        enriched.append(
            {
                "hanzi": fallback_item["hanzi"],
                "meaning_vi": candidate.get("meaning_vi") or fallback_item["meaning_vi"],
                "example_vi": candidate.get("example_vi") or fallback_item["example_vi"],
                "score": float(candidate.get("score") or fallback_item["score"]),
                "tags": [
                    tag
                    for tag in candidate.get("tags", [])
                    if isinstance(tag, str) and tag.strip()
                ],
            }
        )

    return enriched


def translate_sentences(sentences: list[str], model: str | None) -> list[str]:
    if not model or not sentences:
        return ["" for _ in sentences]

    prompt = """
Bạn là trợ lý dịch tiếng Trung sang tiếng Việt.
Trả về JSON object với khóa "items", mỗi item gồm:
- text_zh
- text_vi
""".strip()
    prompt += "\n" + json.dumps(sentences, ensure_ascii=False)

    response = _post_to_ollama(model, prompt)

    if not response or "items" not in response or not isinstance(response["items"], list):
        return ["" for _ in sentences]

    lookup = {
        item.get("text_zh"): item.get("text_vi", "")
        for item in response["items"]
        if isinstance(item, dict)
    }

    return [str(lookup.get(sentence, "")) for sentence in sentences]
