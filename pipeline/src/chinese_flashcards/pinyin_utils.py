from __future__ import annotations

import re

from pypinyin import Style, pinyin


PUNCTUATION = set("，。！？；：、,.!?;:)]}】》」』”’")
OPENING_PUNCTUATION = set("([ {【《「『“‘")


def text_to_pinyin(text: str) -> str:
    if not text:
        return ""

    pieces: list[str] = []

    for chunk in pinyin(
        text,
        style=Style.TONE,
        heteronym=False,
        neutral_tone_with_five=False,
        errors=lambda value: list(value),
    ):
        token = chunk[0]

        if not token:
            continue

        if token.isspace():
            if pieces and pieces[-1] != " ":
                pieces.append(" ")
            continue

        if token in PUNCTUATION:
            if pieces and pieces[-1] == " ":
                pieces.pop()
            pieces.append(token)
            pieces.append(" ")
            continue

        if token in OPENING_PUNCTUATION:
            if pieces and pieces[-1] != " ":
                pieces.append(" ")
            pieces.append(token)
            continue

        if pieces and pieces[-1] not in {" ", *OPENING_PUNCTUATION}:
            pieces.append(" ")

        pieces.append(token)

    rendered = "".join(pieces)
    rendered = re.sub(r"\s+", " ", rendered).strip()
    rendered = re.sub(r"\s+([，。！？；：、,.!?;:)\]}】》」』”’])", r"\1", rendered)
    return rendered


def build_example_pinyin(example_zh: str, hanzi: str, card_pinyin: str) -> str:
    rendered = text_to_pinyin(example_zh)

    if not rendered or not hanzi or not card_pinyin:
        return rendered

    generated_term = text_to_pinyin(hanzi)
    if generated_term and generated_term in rendered:
        return rendered.replace(generated_term, card_pinyin, 1)

    return rendered
