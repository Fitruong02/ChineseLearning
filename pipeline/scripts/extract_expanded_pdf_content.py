from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import cv2
import fitz
import numpy as np
from deep_translator import GoogleTranslator
from rapidocr_onnxruntime import RapidOCR


@dataclass
class VocabEntry:
  lesson_label: str
  lesson_code: str
  hanzi: str
  pinyin: str
  meaning_vi: str


ROOT = Path(__file__).resolve().parents[2]
PDF_PATH = ROOT / "Dịch nói bài đọc thêm.pdf"
MATERIAL_PATH = (
  ROOT
  / "web"
  / "public"
  / "content"
  / "materials"
  / "material-expanded-vocabulary-lessons-1-9.json"
)
DECK_PATH = (
  ROOT
  / "web"
  / "public"
  / "content"
  / "published"
  / "deck-expanded-vocabulary-lessons-1-9.json"
)

MATERIAL_ID = "material-expanded-vocabulary-lessons-1-9"
DECK_ID = "deck-expanded-vocabulary-lessons-1-9"
CREATED_AT = "2026-04-07T10:00:00.000Z"

LESSON_RE = re.compile(r"^第[一二三四五六七八九十]+课[：:].+")
NUMBERED_RE = re.compile(r"^\d+\.\s*(.*)$")
VOCAB_RE = re.compile(r"^(.*?)\s*\((.*?)\)\s*[\u2013\u2014-]\s*(.+)$")


def has_chinese(value: str) -> bool:
  return any("\u4e00" <= char <= "\u9fff" for char in value)


def is_vocab_like_line(value: str) -> bool:
  stripped = value.strip()
  if not stripped:
    return False
  if stripped[0].isdigit() and "." in stripped[:6]:
    return True
  if "(" in stripped and ")" in stripped and ("-" in stripped or "–" in stripped or "—" in stripped):
    return True
  if any("A" <= char <= "z" for char in stripped):
    return True
  return False


def normalize_ocr_line(value: str) -> str:
  normalized = value.strip()
  normalized = normalized.replace("；", "，")
  normalized = normalized.replace(";", "，")
  normalized = normalized.replace("（", "(").replace("）", ")")
  normalized = normalized.replace("“", "「").replace("”", "」")
  normalized = normalized.replace("  ", " ")
  normalized = normalized.replace("...", "…")
  normalized = normalized.replace("，。", "。")
  normalized = normalized.replace("，,", "，")
  normalized = normalized.replace("。.", "。")
  normalized = normalized.replace("自已", "自己")
  normalized = normalized.replace("浚", "深")
  normalized = normalized.replace("一了", "一趟了")
  normalized = normalized.replace("约定的时问", "约定的时间")
  normalized = normalized.replace("使人感到便", "使人感到方便")
  normalized = normalized.replace("旅游时常常会发生一些意想不到的事情", "旅游时常常会发生一些意想不到的事情")
  return normalized


def build_vi_translation(lines: list[str]) -> str:
  if not lines:
    return ""

  translator = GoogleTranslator(source="zh-CN", target="vi")
  paragraph = "".join(lines).strip()
  try:
    translated_paragraph = translator.translate(paragraph)
    if translated_paragraph and translated_paragraph.strip():
      return translated_paragraph.strip()
  except Exception:
    pass

  translated_lines: list[str] = []
  for line in lines:
    try:
      translated = translator.translate(line)
      translated_lines.append(translated.strip())
    except Exception:
      translated_lines.append(f"[OCR] {line}")
  return "\n".join(translated_lines)


def merge_wrapped_lines(lines: list[str]) -> list[str]:
  if not lines:
    return []

  merged: list[str] = []
  sentence_endings = ("。", "！", "？", "；", "：", ".", "!", "?")

  for line in lines:
    if not merged:
      merged.append(line)
      continue

    prev = merged[-1]
    should_join = not prev.endswith(sentence_endings)
    if should_join:
      merged[-1] = f"{prev}{line}"
    else:
      merged.append(line)

  return merged


def extract_vocab_entries(pdf_path: Path) -> list[VocabEntry]:
  doc = fitz.open(pdf_path)
  lines: list[str] = []

  for page in doc:
    for raw in page.get_text("text").splitlines():
      line = " ".join(raw.split()).strip()
      if line:
        lines.append(line)

  entries: list[VocabEntry] = []
  current_lesson: str | None = None
  pending_parts: list[str] | None = None

  def flush_pending() -> None:
    nonlocal pending_parts
    if pending_parts is None or current_lesson is None:
      pending_parts = None
      return

    candidate = " ".join(pending_parts).strip()
    matched = VOCAB_RE.match(candidate)
    if not matched:
      pending_parts = None
      return

    hanzi, pinyin, meaning = (item.strip() for item in matched.groups())
    lesson_code = re.split(r"[：:]", current_lesson)[0]
    entries.append(
      VocabEntry(
        lesson_label=current_lesson,
        lesson_code=lesson_code,
        hanzi=hanzi,
        pinyin=pinyin,
        meaning_vi=meaning,
      ),
    )
    pending_parts = None

  for line in lines:
    if line.isdigit():
      continue

    if LESSON_RE.match(line):
      flush_pending()
      current_lesson = line
      continue

    numbered = NUMBERED_RE.match(line)
    if numbered:
      flush_pending()
      value = numbered.group(1).strip()
      pending_parts = []
      if value:
        pending_parts.append(value)
      continue

    if pending_parts is not None:
      pending_parts.append(line)

  flush_pending()
  return entries


def extract_ocr_dialogue_lines(pdf_path: Path) -> dict[str, list[str]]:
  doc = fitz.open(pdf_path)
  ocr = RapidOCR()

  lesson_lines: dict[str, list[str]] = defaultdict(list)
  current_lesson_code: str | None = None

  for page in doc:
    pix = page.get_pixmap(matrix=fitz.Matrix(2.2, 2.2), alpha=False)
    image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n == 4:
      image = cv2.cvtColor(image, cv2.COLOR_RGBA2RGB)

    results, _ = ocr(image)
    if not results:
      continue

    sorted_results = sorted(
      results,
      key=lambda item: (
        min(point[1] for point in item[0]),
        min(point[0] for point in item[0]),
      ),
    )

    for _, text, score in sorted_results:
      if float(score) < 0.72:
        continue

      line = " ".join(str(text).split()).strip()
      if not line or line.isdigit():
        continue

      if LESSON_RE.match(line):
        current_lesson_code = re.split(r"[：:]", line)[0]
        continue

      if current_lesson_code is None:
        continue

      if is_vocab_like_line(line):
        continue

      if not has_chinese(line):
        continue

      if len(line) < 8:
        continue

      lesson_lines[current_lesson_code].append(normalize_ocr_line(line))

  deduped: dict[str, list[str]] = {}
  for lesson_label, lines in lesson_lines.items():
    unique: list[str] = []
    for line in lines:
      if line not in unique:
        unique.append(line)
    deduped[lesson_label] = merge_wrapped_lines(unique)

  return deduped


def build_segments(text: str, lesson_cards: list[dict[str, str]]) -> list[dict[str, str]]:
  candidates = [
    (card["hanzi"], card["id"])
    for card in lesson_cards
    if len(card["hanzi"]) >= 2
  ]
  candidates.sort(key=lambda item: len(item[0]), reverse=True)

  if not candidates:
    return [{"text": text}]

  segments: list[dict[str, str]] = []
  cursor = 0
  buffer: list[str] = []
  text_length = len(text)

  while cursor < text_length:
    matched_word: str | None = None
    matched_card_id: str | None = None

    for hanzi, card_id in candidates:
      if text.startswith(hanzi, cursor):
        matched_word = hanzi
        matched_card_id = card_id
        break

    if matched_word and matched_card_id:
      if buffer:
        segments.append({"text": "".join(buffer)})
        buffer = []
      segments.append({"text": matched_word, "cardId": matched_card_id})
      cursor += len(matched_word)
      continue

    buffer.append(text[cursor])
    cursor += 1

  if buffer:
    segments.append({"text": "".join(buffer)})

  return segments


def main() -> None:
  entries = extract_vocab_entries(PDF_PATH)
  ocr_lines_by_lesson = extract_ocr_dialogue_lines(PDF_PATH)

  cards: list[dict[str, object]] = []
  for index, entry in enumerate(entries, start=1):
    cards.append(
      {
        "id": f"card-expanded-vocab-{index:03d}",
        "deckId": DECK_ID,
        "hanzi": entry.hanzi,
        "pinyin": entry.pinyin,
        "meaningVi": entry.meaning_vi,
        "exampleZh": f"课文常见词：{entry.hanzi}。",
        "exampleVi": f"Tu '{entry.hanzi}' nghia la: {entry.meaning_vi}.",
        "audioText": entry.hanzi,
        "tags": ["expanded", entry.lesson_code],
      },
    )

  section_map: dict[str, list[tuple[VocabEntry, dict[str, object]]]] = defaultdict(list)
  for entry, card in zip(entries, cards, strict=False):
    section_map[entry.lesson_label].append((entry, card))

  sections: list[dict[str, object]] = []
  for lesson_label, pairs in section_map.items():
    lesson_code = pairs[0][0].lesson_code
    lesson_cards = [pair[1] for pair in pairs]
    ocr_lines = ocr_lines_by_lesson.get(lesson_code, [])

    if ocr_lines:
      text_zh = "\n".join(ocr_lines)
      text_vi = build_vi_translation(ocr_lines)
      segments = build_segments(text_zh, lesson_cards)
    else:
      text_zh = "、".join(pair[0].hanzi for pair in pairs)
      text_vi = " | ".join(f"{pair[0].hanzi}: {pair[0].meaning_vi}" for pair in pairs)
      segments = []
      for idx, (_, card) in enumerate(pairs):
        segments.append({"text": card["hanzi"], "cardId": card["id"]})
        if idx < len(pairs) - 1:
          segments.append({"text": "、"})

    sections.append(
      {
        "id": f"{lesson_code}-expanded".lower(),
        "heading": lesson_label,
        "textZh": text_zh,
        "textVi": text_vi,
        "focusCardIds": [card["id"] for card in lesson_cards],
        "segments": segments,
      },
    )

  material = {
    "id": MATERIAL_ID,
    "title": "Expanded Vocabulary Lessons 1-9",
    "type": "pdf",
    "originPath": PDF_PATH.name,
    "language": "zh-CN",
    "importedAt": CREATED_AT,
    "ocrMode": "ocr",
    "summary": "Vocabulary + dialogue extracted from PDF in source order across lessons 1-9.",
    "tags": ["expanded", "lessons-1-9", "pdf", "ocr"],
    "linkedDeckIds": [DECK_ID],
    "sections": sections,
  }

  deck = {
    "id": DECK_ID,
    "title": "Expanded Vocabulary Lessons 1-9",
    "description": "Extended deck extracted from PDF, preserving lesson and item order for flashcard review.",
    "level": "HSK 2-4",
    "materialId": MATERIAL_ID,
    "createdAt": CREATED_AT,
    "tags": ["expanded", "lessons-1-9", "flashcard", "pdf"],
    "cards": cards,
  }

  MATERIAL_PATH.write_text(json.dumps(material, ensure_ascii=False, indent=2), encoding="utf-8")
  DECK_PATH.write_text(json.dumps(deck, ensure_ascii=False, indent=2), encoding="utf-8")

  print(f"Parsed vocab entries: {len(entries)}")
  print(f"OCR lessons with dialogue: {len(ocr_lines_by_lesson)}")
  for lesson, lines in ocr_lines_by_lesson.items():
    print(f"- {lesson}: {len(lines)} lines")
  print(f"Wrote material: {MATERIAL_PATH}")
  print(f"Wrote deck: {DECK_PATH}")


if __name__ == "__main__":
  main()
