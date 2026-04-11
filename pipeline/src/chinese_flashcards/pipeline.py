from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .dictionary import CedictEntry, load_cedict
from .llm import CandidateDraft, enrich_candidates, translate_sentences
from .models import (
    DraftCard,
    DraftDeck,
    MaterialSection,
    MaterialSegment,
    MaterialSource,
    PublishedCard,
    PublishedDeck,
)
from .pinyin_utils import build_example_pinyin, text_to_pinyin

SENTENCE_SPLIT = re.compile(r"(?<=[。！？!?])\s*")
CHINESE_TOKEN = re.compile(r"[\u4e00-\u9fff]{1,8}")


@dataclass(slots=True)
class IngestResult:
    material_path: Path
    draft_path: Path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def slugify(text: str) -> str:
    normalized = (
        unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    )
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()

    if cleaned:
        return cleaned

    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]
    return f"material-{digest}"


def stable_id(prefix: str, text: str) -> str:
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
    return f"{prefix}-{digest}"


def read_text(path: Path, allow_ocr: bool = True) -> tuple[str, str]:
    suffix = path.suffix.lower()

    if suffix in {".txt", ".md"}:
        return path.read_text(encoding="utf-8"), "manual"

    if suffix != ".pdf":
        raise ValueError(f"Unsupported material type: {path.suffix}")

    try:
        import fitz  # type: ignore
    except ModuleNotFoundError as error:
        raise RuntimeError("PyMuPDF is required to read PDF files.") from error

    document = fitz.open(path)
    extracted_pages: list[str] = []
    requires_ocr = False

    for page in document:
        text = page.get_text("text").strip()

        if text and len(text) > 80:
            extracted_pages.append(text)
            continue

        if allow_ocr:
            requires_ocr = True
            extracted_pages.append(run_ocr_on_page(page))

    return "\n".join(extracted_pages), ("ocr" if requires_ocr else "embedded-text")


def run_ocr_on_page(page: object) -> str:
    try:
        import fitz  # type: ignore
        import numpy as np  # type: ignore
        from PIL import Image  # type: ignore
        from paddleocr import PaddleOCR  # type: ignore
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "OCR requires numpy, pillow, paddleocr and paddlepaddle to be installed."
        ) from error

    if not hasattr(run_ocr_on_page, "_ocr"):
        run_ocr_on_page._ocr = PaddleOCR(use_angle_cls=True, lang="ch")  # type: ignore[attr-defined]

    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
    result = run_ocr_on_page._ocr.ocr(np.array(image), cls=True)  # type: ignore[attr-defined]
    lines: list[str] = []

    for block in result or []:
        for item in block or []:
            if len(item) >= 2 and item[1]:
                lines.append(str(item[1][0]))

    return "\n".join(lines)


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_sentences(text: str) -> list[str]:
    sentences = [part.strip() for part in SENTENCE_SPLIT.split(text) if part.strip()]
    return [sentence for sentence in sentences if len(sentence) > 1]


def tokenize(sentence: str) -> list[str]:
    try:
        import jieba  # type: ignore
    except ModuleNotFoundError:
        return CHINESE_TOKEN.findall(sentence)

    tokens = [token.strip() for token in jieba.lcut(sentence) if CHINESE_TOKEN.fullmatch(token)]
    return tokens


def choose_tags(term: str, sentence: str) -> list[str]:
    tags: list[str] = []

    if any(keyword in sentence for keyword in ("医院", "医生", "护士")):
        tags.append("y tế")
    if any(keyword in sentence for keyword in ("图书馆", "生词", "学习")):
        tags.append("học tập")
    if any(keyword in sentence for keyword in ("楼", "左边", "前")):
        tags.append("chỉ đường")
    if len(term) >= 4:
        tags.append("cụm từ")

    return tags


def build_candidate_terms(
    sentences: Iterable[str],
    dictionary: dict[str, CedictEntry],
    max_cards: int,
) -> list[dict[str, str | float | list[str]]]:
    sentence_lookup: dict[str, str] = {}
    counter: Counter[str] = Counter()

    for sentence in sentences:
        for token in tokenize(sentence):
            if len(token) == 1 and token not in dictionary:
                continue

            counter[token] += 1
            sentence_lookup.setdefault(token, sentence)

    ranked: list[dict[str, str | float | list[str]]] = []

    for token, frequency in counter.most_common():
        entry = dictionary.get(token)

        if not entry and len(token) < 2:
            continue

        definition = entry.definitions[0] if entry else "Chinese term"
        pinyin = entry.pinyin_tone if entry else ""
        base_score = min(0.98, 0.38 + frequency * 0.14 + (0.18 if entry else 0.0))

        ranked.append(
            {
                "hanzi": token,
                "pinyin": pinyin,
                "definition": definition,
                "example_zh": sentence_lookup[token],
                "base_score": round(base_score, 2),
                "tags": choose_tags(token, sentence_lookup[token]),
            }
        )

        if len(ranked) >= max_cards:
            break

    return ranked


def annotate_sentence(sentence: str, card_lookup: dict[str, str]) -> list[MaterialSegment]:
    if not card_lookup:
        return [MaterialSegment(text=sentence)]

    segments: list[MaterialSegment] = []
    cursor = 0
    ordered_terms = sorted(card_lookup, key=len, reverse=True)

    while cursor < len(sentence):
        match_term = None

        for term in ordered_terms:
            if sentence.startswith(term, cursor):
                match_term = term
                break

        if not match_term:
            next_cursor = cursor + 1
            segments.append(MaterialSegment(text=sentence[cursor:next_cursor]))
            cursor = next_cursor
            continue

        segments.append(MaterialSegment(text=match_term, cardId=card_lookup[match_term]))
        cursor += len(match_term)

    merged: list[MaterialSegment] = []

    for segment in segments:
        if merged and merged[-1].cardId is None and segment.cardId is None:
            merged[-1].text += segment.text
        else:
            merged.append(segment)

    return merged


def update_manifest(content_root: Path) -> Path:
    prefix = "content/"
    manifest = {
        "version": 1,
        "generatedAt": now_iso(),
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
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def ingest_material(
    source_path: Path,
    content_root: Path,
    ollama_model: str | None,
    cedict_path: Path | None,
    max_cards: int,
    allow_ocr: bool = True,
    topic: str | None = None,
) -> IngestResult:
    text, ocr_mode = read_text(source_path, allow_ocr=allow_ocr)
    cleaned_text = normalize_text(text)
    sentences = split_sentences(cleaned_text)

    if not sentences:
        raise RuntimeError("No usable text was extracted from the source material.")

    dictionary = load_cedict(cedict_path)
    candidates = build_candidate_terms(sentences, dictionary, max_cards=max_cards)
    enriched = enrich_candidates(
        [
            CandidateDraft(
                hanzi=str(candidate["hanzi"]),
                pinyin=str(candidate["pinyin"]),
                definition=str(candidate["definition"]),
                example_zh=str(candidate["example_zh"]),
                base_score=float(candidate["base_score"]),
            )
            for candidate in candidates
        ],
        ollama_model,
    )
    translated_sections = translate_sentences(sentences, ollama_model)

    slug = slugify(source_path.stem)
    material_id = f"material-{slug}"
    draft_id = f"draft-{slug}"
    card_ids: dict[str, str] = {}
    draft_cards: list[DraftCard] = []

    topic_tag = topic.strip() if topic else None
    extra_topic_tags = [topic_tag] if topic_tag else []

    for candidate, enrichment in zip(candidates, enriched, strict=False):
        hanzi = str(candidate["hanzi"])
        card_id = stable_id("draft", hanzi)
        card_ids[hanzi] = card_id
        tags = list(
            dict.fromkeys(
                [
                    *candidate["tags"],
                    *enrichment.get("tags", []),
                    *extra_topic_tags,
                ]
            )
        )

        draft_cards.append(
            DraftCard(
                id=card_id,
                materialId=material_id,
                hanzi=hanzi,
                pinyin=str(candidate["pinyin"]),
                meaningVi=str(enrichment["meaning_vi"]),
                exampleZh=str(candidate["example_zh"]),
                examplePinyin=build_example_pinyin(
                    str(candidate["example_zh"]),
                    hanzi,
                    str(candidate["pinyin"]),
                ),
                exampleVi=str(enrichment["example_vi"]),
                sourceSnippet=str(candidate["example_zh"]),
                tags=tags,
                confidence=round(float(enrichment["score"]), 2),
                status="draft" if float(enrichment["score"]) < 0.82 else "approved",
            )
        )

    sections: list[MaterialSection] = []

    for index, sentence in enumerate(sentences, start=1):
        focus_card_ids = [
            card_id for hanzi, card_id in card_ids.items() if hanzi in sentence
        ]
        sections.append(
            MaterialSection(
                id=f"{material_id}-section-{index}",
                heading=f"Đoạn {index}",
                textZh=sentence,
                textPinyin=text_to_pinyin(sentence),
                textVi=translated_sections[index - 1],
                focusCardIds=focus_card_ids[:8],
                segments=annotate_sentence(sentence, card_ids),
            )
        )

    material = MaterialSource(
        id=material_id,
        title=source_path.stem,
        type="pdf" if source_path.suffix.lower() == ".pdf" else "text",
        originPath=str(source_path).replace("\\", "/"),
        language="zh-CN",
        importedAt=now_iso(),
        ocrMode=ocr_mode,
        summary=f"Tự động ingest từ {source_path.name} bằng pipeline local.",
        tags=["pipeline", "auto-import", ocr_mode, *extra_topic_tags],
        linkedDeckIds=[],
        sections=sections,
    )
    draft_deck = DraftDeck(
        id=draft_id,
        title=f"Nháp: {source_path.stem}",
        description="Deck AI sinh tự động từ tài liệu nguồn, cần duyệt trước khi publish.",
        level="Auto",
        materialId=material_id,
        createdAt=now_iso(),
        sourcePath=str(source_path).replace("\\", "/"),
        model=ollama_model or "fallback",
        tags=["draft", ocr_mode, *extra_topic_tags],
        notes=[
            "Cards có confidence thấp nên được xem lại trước khi publish.",
            "Nếu OCR làm bẩn câu ví dụ, chỉnh tay trong tab Drafts của web app.",
        ],
        cards=draft_cards,
    )

    material_path = content_root / "materials" / f"{material_id}.json"
    draft_path = content_root / "drafts" / f"{draft_id}.json"
    write_json(material_path, material.to_dict())
    write_json(draft_path, draft_deck.to_dict())
    update_manifest(content_root)
    return IngestResult(material_path=material_path, draft_path=draft_path)


def _published_card_from_payload(payload: dict, deck_id: str) -> PublishedCard:
    return PublishedCard(
        id=str(payload["id"]),
        deckId=deck_id,
        hanzi=str(payload["hanzi"]),
        pinyin=str(payload.get("pinyin", "")),
        meaningVi=str(payload.get("meaningVi", "")),
        exampleZh=str(payload.get("exampleZh", "")),
        examplePinyin=str(
            payload.get("examplePinyin")
            or build_example_pinyin(
                str(payload.get("exampleZh", "")),
                str(payload["hanzi"]),
                str(payload.get("pinyin", "")),
            )
        ),
        exampleVi=str(payload.get("exampleVi", "")),
        audioText=str(payload.get("audioText", payload["hanzi"])),
        tags=list(payload.get("tags", [])),
    )


def export_published_deck(
    draft_path: Path,
    output_root: Path,
    min_confidence: float,
    merge_with: Path | None = None,
) -> tuple[Path, Path]:
    payload = json.loads(draft_path.read_text(encoding="utf-8"))
    deck_id = str(payload["id"]).replace("draft-", "deck-")

    merged_payload: dict | None = None
    if merge_with:
        merged_payload = json.loads(merge_with.read_text(encoding="utf-8"))
        deck_id = str(merged_payload.get("id", deck_id))

    approved_cards = [
        card
        for card in payload["cards"]
        if card.get("status") != "rejected"
        and float(card.get("confidence", 0)) >= min_confidence
    ]

    grouped: dict[str, dict] = {}

    for card in approved_cards:
        owner_id = card.get("mergedInto") or card["id"]
        current = grouped.get(owner_id)

        if not current:
            grouped[owner_id] = card
            continue

        current["tags"] = sorted(set([*current.get("tags", []), *card.get("tags", [])]))

    imported_cards = [
        PublishedCard(
            id=str(card["id"]).replace("draft-", "card-"),
            deckId=deck_id,
            hanzi=card["hanzi"],
            pinyin=card["pinyin"],
            meaningVi=card["meaningVi"],
            exampleZh=card["exampleZh"],
            examplePinyin=str(
                card.get("examplePinyin")
                or build_example_pinyin(card["exampleZh"], card["hanzi"], card["pinyin"])
            ),
            exampleVi=card["exampleVi"],
            audioText=card["hanzi"],
            tags=card.get("tags", []),
        )
        for card in grouped.values()
    ]

    merged_tags = set(payload.get("tags", []))
    merged_cards_by_hanzi = {card.hanzi: card for card in imported_cards}

    if merged_payload:
        merged_tags.update(merged_payload.get("tags", []))
        for existing in merged_payload.get("cards", []):
            existing_card = _published_card_from_payload(existing, deck_id)
            candidate = merged_cards_by_hanzi.get(existing_card.hanzi)

            if candidate:
                candidate.tags = sorted(set([*candidate.tags, *existing_card.tags]))
            else:
                merged_cards_by_hanzi[existing_card.hanzi] = existing_card

    published_cards = sorted(merged_cards_by_hanzi.values(), key=lambda item: item.hanzi)

    published = PublishedDeck(
        id=deck_id,
        title=(
            str(merged_payload.get("title"))
            if merged_payload
            else str(payload["title"]).replace("Nháp: ", "")
        ),
        description=(
            str(merged_payload.get("description"))
            if merged_payload
            else str(payload["description"])
        ),
        level=(
            str(merged_payload.get("level")) if merged_payload else str(payload["level"])
        ),
        materialId=(
            str(merged_payload.get("materialId"))
            if merged_payload
            else str(payload["materialId"])
        ),
        createdAt=now_iso(),
        tags=sorted(merged_tags),
        cards=published_cards,
    )

    published_path = (
        merge_with.resolve()
        if merge_with is not None
        else output_root / "published" / f"{deck_id}.json"
    )
    csv_path = output_root / "published" / f"{deck_id}.csv"
    write_json(published_path, published.to_dict())
    material_path = output_root / "materials" / f'{payload["materialId"]}.json'

    if material_path.exists():
        material_payload = json.loads(material_path.read_text(encoding="utf-8"))
        linked_decks = material_payload.get("linkedDeckIds", [])

        if deck_id not in linked_decks:
            material_payload["linkedDeckIds"] = [*linked_decks, deck_id]
            write_json(material_path, material_payload)

    csv_rows = ["hanzi,pinyin,meaningVi,exampleZh,examplePinyin,exampleVi,tags"]

    for card in published.cards:
        csv_rows.append(
            ",".join(
                [
                    _escape_csv(card.hanzi),
                    _escape_csv(card.pinyin),
                    _escape_csv(card.meaningVi),
                    _escape_csv(card.exampleZh),
                    _escape_csv(card.examplePinyin),
                    _escape_csv(card.exampleVi),
                    _escape_csv(" ".join(card.tags)),
                ]
            )
        )

    csv_path.write_text("\n".join(csv_rows), encoding="utf-8")
    update_manifest(output_root)
    return published_path, csv_path


def _escape_csv(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'
