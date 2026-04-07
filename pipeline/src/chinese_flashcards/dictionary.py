from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


CEDICT_LINE = re.compile(
    r"^(?P<traditional>\S+)\s+(?P<simplified>\S+)\s+\[(?P<pinyin>.+?)\]\s+/(?P<definitions>.+)/$"
)

VOWEL_PRIORITY = "aAeEoO"
TONE_MARKS = {
    "a": "āáǎà",
    "e": "ēéěè",
    "i": "īíǐì",
    "o": "ōóǒò",
    "u": "ūúǔù",
    "ü": "ǖǘǚǜ",
    "A": "ĀÁǍÀ",
    "E": "ĒÉĚÈ",
    "I": "ĪÍǏÌ",
    "O": "ŌÓǑÒ",
    "U": "ŪÚǓÙ",
    "Ü": "ǕǗǙǛ",
}


@dataclass(slots=True)
class CedictEntry:
    simplified: str
    traditional: str
    pinyin_numbered: str
    pinyin_tone: str
    definitions: list[str]


def _convert_syllable(syllable: str) -> str:
    if not syllable:
        return syllable

    tone = syllable[-1]

    if not tone.isdigit():
        return syllable.replace("u:", "ü").replace("v", "ü")

    body = syllable[:-1].replace("u:", "ü").replace("v", "ü")

    if tone == "5" or tone == "0":
        return body

    tone_index = int(tone) - 1
    target_index = -1

    for vowel in VOWEL_PRIORITY:
        target_index = body.find(vowel)
        if target_index != -1:
            break

    if target_index == -1 and "ou" in body:
        target_index = body.find("o")

    if target_index == -1:
        for index, character in enumerate(body):
            if character.lower() in {"i", "u", "ü"}:
                target_index = index

    if target_index == -1:
        return body

    vowel = body[target_index]
    marked = TONE_MARKS.get(vowel, vowel * 4)[tone_index]
    return f"{body[:target_index]}{marked}{body[target_index + 1:]}"


def numbered_pinyin_to_tone(pinyin: str) -> str:
    return " ".join(_convert_syllable(chunk) for chunk in pinyin.split())


def resolve_cedict_path(explicit_path: Path | None = None) -> Path:
    if explicit_path and explicit_path.exists():
        return explicit_path

    project_root = Path(__file__).resolve().parents[3]
    full_path = project_root / "pipeline" / "resources" / "cedict_ts.u8"

    if full_path.exists():
        return full_path

    return project_root / "pipeline" / "resources" / "mini_cedict.u8"


def load_cedict(explicit_path: Path | None = None) -> dict[str, CedictEntry]:
    dictionary_path = resolve_cedict_path(explicit_path)
    entries: dict[str, CedictEntry] = {}

    for raw_line in dictionary_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#"):
            continue

        match = CEDICT_LINE.match(line)
        if not match:
            continue

        simplified = match.group("simplified")
        traditional = match.group("traditional")
        numbered = match.group("pinyin")
        definitions = [part.strip() for part in match.group("definitions").split("/") if part.strip()]

        if simplified not in entries:
            entries[simplified] = CedictEntry(
                simplified=simplified,
                traditional=traditional,
                pinyin_numbered=numbered,
                pinyin_tone=numbered_pinyin_to_tone(numbered),
                definitions=definitions,
            )

    return entries
