from __future__ import annotations

import re
from functools import lru_cache


MAJOR_SENTENCE_PUNCTUATION = ("。", "！", "？", "!", "?", ";", "；", "\n")
MINOR_SENTENCE_HINTS = ("，", ",", "：", ":")
POS_TO_CATEGORY = {
    "i": "idiom",
    "l": "phrase",
    "j": "phrase",
    "n": "noun",
    "nr": "noun",
    "ns": "noun",
    "nt": "noun",
    "nz": "noun",
    "t": "noun",
    "s": "noun",
    "f": "noun",
    "v": "verb",
    "vd": "verb",
    "vn": "verb",
    "a": "adjective",
    "ad": "adjective",
    "an": "adjective",
    "d": "adverb",
}


def _pinyin_syllable_count(text: str) -> int:
    return len(re.findall(r"[A-Za-züÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+", text))


def infer_card_kind(hanzi: str, pinyin: str = "", tags: list[str] | None = None) -> str:
    cleaned_hanzi = re.sub(r"\s+", "", hanzi or "")
    if not cleaned_hanzi:
        return "sentence"

    if tags and "vocab-auto" in tags:
        return "term"

    if any(mark in hanzi for mark in MAJOR_SENTENCE_PUNCTUATION):
        return "sentence"

    if len(cleaned_hanzi) > 10:
        return "sentence"

    syllable_count = _pinyin_syllable_count(pinyin)
    if syllable_count > 5:
        return "sentence"

    if len(cleaned_hanzi) > 8 and any(mark in hanzi for mark in MINOR_SENTENCE_HINTS):
        return "sentence"

    if any(character.isdigit() for character in cleaned_hanzi) and len(cleaned_hanzi) > 10:
        return "sentence"

    return "term"


@lru_cache(maxsize=4096)
def _lookup_pos_flag(text: str) -> str | None:
    try:
        import jieba.posseg as pseg  # type: ignore
    except ModuleNotFoundError:
        return None

    pieces = pseg.lcut(text)
    if len(pieces) == 1 and pieces[0].word.strip() == text:
        return pieces[0].flag or None

    return None


def infer_part_of_speech(hanzi: str, card_kind: str) -> str | None:
    if card_kind != "term":
        return None

    cleaned_hanzi = re.sub(r"\s+", "", hanzi or "")
    if not cleaned_hanzi:
        return None

    if any(mark in cleaned_hanzi for mark in ("，", ",", "、")):
        return "idiom" if len(cleaned_hanzi) <= 8 else "phrase"

    pos_flag = _lookup_pos_flag(cleaned_hanzi)
    if pos_flag:
        for prefix, category in POS_TO_CATEGORY.items():
            if pos_flag.startswith(prefix):
                return category

    if len(cleaned_hanzi) <= 4:
        return "phrase"

    return "unknown"
