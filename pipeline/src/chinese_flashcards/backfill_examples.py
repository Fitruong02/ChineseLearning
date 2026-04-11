from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path

from .pinyin_utils import build_example_pinyin


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _update_manifest(content_root: Path) -> None:
    prefix = "content/"
    manifest = {
        "version": 1,
        "generatedAt": "",
        "materials": sorted(
            prefix + str(path.relative_to(content_root)).replace("\\", "/")
            for path in (content_root / "materials").glob("*.json")
        ),
        "publishedDecks": sorted(
            prefix + str(path.relative_to(content_root)).replace("\\", "/")
            for path in (content_root / "published").glob("*.json")
        ),
        "draftDecks": sorted(
            prefix + str(path.relative_to(content_root)).replace("\\", "/")
            for path in (content_root / "drafts").glob("*.json")
        ),
    }
    manifest_path = content_root / "manifest.json"
    existing_generated_at = ""
    if manifest_path.exists():
        existing = _read_json(manifest_path)
        existing_generated_at = str(existing.get("generatedAt", ""))
    manifest["generatedAt"] = existing_generated_at
    _write_json(manifest_path, manifest)


ZH_SENTENCE_RE = re.compile(r'[^。！？!?；;\n]+[。！？!?；;][”"’』」]?|[^。！？!?；;\n]+$')
VI_SENTENCE_RE = re.compile(r'[^.!?\n]+[.!?][”"’]?|[^.!?\n]+$')


def _split_zh_sentences(text: str) -> list[str]:
    compact = text.replace("\r\n", "\n").replace("\r", "\n")
    return [part.strip() for part in ZH_SENTENCE_RE.findall(compact) if part.strip()]


def _split_vi_sentences(text: str) -> list[str]:
    compact = text.replace("\r\n", "\n").replace("\r", "\n")
    return [part.strip() for part in VI_SENTENCE_RE.findall(compact) if part.strip()]


def _split_lines(text: str) -> list[str]:
    compact = text.replace("\r\n", "\n").replace("\r", "\n")
    return [line.strip() for line in compact.split("\n") if line.strip()]


def _normalize_vi_tokens(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"\w+", text.lower(), flags=re.UNICODE)
        if len(token) > 1
    }


def _pick_best_vi_sentence(vi_sentences: list[str], meaning_vi: str) -> str:
    meaning_tokens = _normalize_vi_tokens(meaning_vi)
    if not meaning_tokens:
        return ""

    best_sentence = ""
    best_score = 0
    for sentence in vi_sentences:
        overlap_score = len(meaning_tokens & _normalize_vi_tokens(sentence))
        if overlap_score > best_score:
            best_sentence = sentence
            best_score = overlap_score

    return best_sentence


def _find_sentence_in_line(
    zh_line: str,
    vi_line: str,
    hanzi: str,
    meaning_vi: str,
) -> tuple[str, str] | None:
    zh_sentences = _split_zh_sentences(zh_line)
    vi_sentences = _split_vi_sentences(vi_line)

    for index, sentence in enumerate(zh_sentences):
        if hanzi not in sentence:
            continue

        if len(vi_sentences) == len(zh_sentences) and index < len(vi_sentences):
            return sentence, vi_sentences[index]

        best_sentence = _pick_best_vi_sentence(vi_sentences, meaning_vi)
        if best_sentence:
            return sentence, best_sentence

        if index < len(vi_sentences):
            return sentence, vi_sentences[index]

        return sentence, vi_line.strip()

    return None


def _align_vi_lines_to_zh_lines(zh_lines: list[str], vi_text: str) -> list[str]:
    vi_sentences = _split_vi_sentences(vi_text)
    if not zh_lines or not vi_sentences or len(vi_sentences) < len(zh_lines):
        return [vi_text] if vi_text.strip() else []

    zh_sentence_counts = [max(1, len(_split_zh_sentences(line))) for line in zh_lines]

    @lru_cache(maxsize=None)
    def solve(sentence_index: int, line_index: int) -> tuple[float, tuple[int, ...]]:
        remaining_lines = len(zh_sentence_counts) - line_index
        remaining_sentences = len(vi_sentences) - sentence_index

        if remaining_lines == 0:
            if sentence_index == len(vi_sentences):
                return 0.0, ()
            return math.inf, ()

        if remaining_sentences < remaining_lines:
            return math.inf, ()

        best_cost = math.inf
        best_partition: tuple[int, ...] = ()
        max_group_size = remaining_sentences - (remaining_lines - 1)

        for group_size in range(1, max_group_size + 1):
            tail_cost, tail_partition = solve(sentence_index + group_size, line_index + 1)
            if math.isinf(tail_cost):
                continue

            current_cost = abs(group_size - zh_sentence_counts[line_index]) + tail_cost
            if current_cost < best_cost:
                best_cost = current_cost
                best_partition = (group_size, *tail_partition)

        return best_cost, best_partition

    _, partition = solve(0, 0)
    if not partition:
        return [vi_text] if vi_text.strip() else []

    aligned_lines: list[str] = []
    cursor = 0
    for group_size in partition:
        aligned_lines.append(" ".join(vi_sentences[cursor: cursor + group_size]).strip())
        cursor += group_size

    return aligned_lines


def _find_sentence_pair(material_payload: dict, card: dict) -> tuple[str, str]:
    hanzi = str(card.get("hanzi", ""))
    card_id = str(card.get("id", ""))
    meaning_vi = str(card.get("meaningVi", ""))

    for section in material_payload.get("sections", []):
        has_direct_link = any(
            segment.get("cardId") == card_id for segment in section.get("segments", [])
        )
        if not has_direct_link and hanzi not in str(section.get("textZh", "")):
            continue

        rows = section.get("rows", [])
        if isinstance(rows, list):
            for row in rows:
                zh_line = str(row.get("zh", "")).strip()
                vi_line = str(row.get("vi", "")).strip()
                if not zh_line or hanzi not in zh_line:
                    continue

                matched = _find_sentence_in_line(zh_line, vi_line, hanzi, meaning_vi)
                if matched:
                    return matched
                return zh_line, vi_line

        zh_lines = _split_lines(str(section.get("textZh", "")))
        vi_lines = _split_lines(str(section.get("textVi", "")))
        if len(vi_lines) == 1 and len(zh_lines) > 1:
            aligned_vi_lines = _align_vi_lines_to_zh_lines(zh_lines, vi_lines[0])
            if len(aligned_vi_lines) == len(zh_lines):
                vi_lines = aligned_vi_lines

        for index, zh_line in enumerate(zh_lines):
            if hanzi not in zh_line:
                continue

            if len(vi_lines) == 1 and len(zh_lines) > 1:
                vi_sentences = _split_vi_sentences(vi_lines[0])
                sentence_offset = sum(
                    len(_split_zh_sentences(previous_line)) for previous_line in zh_lines[:index]
                )

                for sentence_index, sentence in enumerate(_split_zh_sentences(zh_line)):
                    if hanzi not in sentence:
                        continue

                    overall_index = sentence_offset + sentence_index
                    if overall_index < len(vi_sentences):
                        return sentence, vi_sentences[overall_index]
                    return sentence, vi_lines[0]

            vi_line = (
                vi_lines[index]
                if index < len(vi_lines)
                else vi_lines[0]
                if len(vi_lines) == 1
                else ""
            )
            matched = _find_sentence_in_line(zh_line, vi_line, hanzi, meaning_vi)
            if matched:
                return matched
            return zh_line, vi_line

        zh_sentences = _split_zh_sentences(str(section.get("textZh", "")))
        vi_sentences = _split_vi_sentences(str(section.get("textVi", "")))

        for index, sentence in enumerate(zh_sentences):
            if hanzi not in sentence:
                continue

            if len(vi_sentences) == len(zh_sentences) and index < len(vi_sentences):
                return sentence, vi_sentences[index]

            if index < len(vi_sentences):
                return sentence, vi_sentences[index]

            return sentence, str(section.get("textVi", "")).strip()

    return str(card.get("exampleZh", "")).strip(), str(card.get("exampleVi", "")).strip()


def backfill_published_examples(content_root: Path) -> list[Path]:
    published_paths = sorted((content_root / "published").glob("*.json"))
    updated_paths: list[Path] = []

    for published_path in published_paths:
        payload = _read_json(published_path)
        material_id = str(payload.get("materialId", ""))
        material_path = content_root / "materials" / f"{material_id}.json"

        if not material_path.exists():
            continue

        material_payload = _read_json(material_path)
        did_change = False

        for card in payload.get("cards", []):
            example_zh, example_vi = _find_sentence_pair(material_payload, card)
            example_pinyin = build_example_pinyin(
                example_zh,
                str(card.get("hanzi", "")),
                str(card.get("pinyin", "")),
            )

            if example_zh and card.get("exampleZh") != example_zh:
                card["exampleZh"] = example_zh
                did_change = True

            if example_vi and card.get("exampleVi") != example_vi:
                card["exampleVi"] = example_vi
                did_change = True

            if example_pinyin and card.get("examplePinyin") != example_pinyin:
                card["examplePinyin"] = example_pinyin
                did_change = True

        if did_change:
            _write_json(published_path, payload)
            updated_paths.append(published_path)

    if updated_paths:
        _update_manifest(content_root)

    return updated_paths
