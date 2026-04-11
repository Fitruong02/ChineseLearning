from __future__ import annotations

import json
import re
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


def _find_sentence_pair(material_payload: dict, card: dict) -> tuple[str, str]:
    hanzi = str(card.get("hanzi", ""))
    card_id = str(card.get("id", ""))

    for section in material_payload.get("sections", []):
        has_direct_link = any(
            segment.get("cardId") == card_id for segment in section.get("segments", [])
        )
        if not has_direct_link and hanzi not in str(section.get("textZh", "")):
            continue

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
