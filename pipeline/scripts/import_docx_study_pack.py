from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
import zipfile
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET


W_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
WEEK_RE = re.compile(r"^Tuần\s+\d+$", re.IGNORECASE)
NUMBERED_PREFIX_RE = re.compile(r"^\s*\d+\s*[\.,、:：)．]\s*")
NUMBERED_ITEM_RE = re.compile(r"^\s*(\d+)\s*[\.,、:：)．]\s*(.+)$")
PINYIN_TONE_CHARS = set("āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ")
VI_UNIQUE_CHARS = set("ăâđêôơưĂÂĐÊÔƠƯ")
VI_HINT_WORDS = (
    " là ",
    " của ",
    " và ",
    " cho ",
    " người ",
    " việt nam",
    " trung quốc",
    " công ty",
    " dự án",
    " cuộc họp",
)
LATIN_TEXT_RE = re.compile(r"[A-Za-zÀ-ỹ]")
CJK_TEXT_RE = re.compile(r"[\u4e00-\u9fff]")
TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t"


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
    return f"docx-{digest}"


def stable_id(prefix: str, text: str) -> str:
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
    return f"{prefix}-{digest}"


@lru_cache(maxsize=None)
def translate_text(text: str, source_language: str, target_language: str) -> str:
    if not text.strip():
        return ""

    request = Request(
        f"{TRANSLATE_ENDPOINT}&sl={quote(source_language)}&tl={quote(target_language)}&q={quote(text)}",
        headers={"User-Agent": "Mozilla/5.0"},
    )

    with urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))

    translated = "".join(
        part[0] for part in payload[0] if isinstance(part, list) and part and part[0]
    )
    return translated.strip()


def translate_zh_to_vi(text: str) -> str:
    return translate_text(text, "zh-CN", "vi")


def render_text_pinyin(text: str) -> str:
    if not text:
        return ""

    try:
        from pypinyin import Style, pinyin
    except ModuleNotFoundError:
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
        if re.fullmatch(r"[\u4e00-\u9fff]", token):
            if pieces and pieces[-1] != " ":
                pieces.append(" ")
            pieces.append(token)
            continue
        if pieces and pieces[-1] == " ":
            pieces.pop()
        pieces.append(token)

    return re.sub(r"\s+", " ", "".join(pieces)).strip()


def read_docx_paragraphs(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))

    paragraphs = [
        "".join(node.text or "" for node in paragraph.findall(".//w:t", W_NS)).strip()
        for paragraph in root.findall(".//w:p", W_NS)
    ]
    return [paragraph for paragraph in paragraphs if paragraph]


def classify_paragraph(text: str) -> str:
    cjk_count = len(CJK_TEXT_RE.findall(text))
    latin_count = len(LATIN_TEXT_RE.findall(text))
    lowered = f" {text.lower()} "
    has_non_pinyin_latin_diacritic = any(
        char.isalpha() and ord(char) > 127 and char not in PINYIN_TONE_CHARS
        for char in text
    )

    if cjk_count and latin_count:
        if has_non_pinyin_latin_diacritic or any(hint in lowered for hint in VI_HINT_WORDS):
            return "vi"
        if latin_count > cjk_count:
            return "vi"
        return "zh"

    if cjk_count:
        return "zh"
    if any(char in VI_UNIQUE_CHARS for char in text):
        return "vi"
    if has_non_pinyin_latin_diacritic:
        return "vi"
    if any(hint in lowered for hint in VI_HINT_WORDS):
        return "vi"
    if any(char in PINYIN_TONE_CHARS for char in text):
        return "pinyin"
    return "vi"


def clean_item(text: str) -> str:
    return NUMBERED_PREFIX_RE.sub("", text).strip()


def group_numbered_blocks(items: list[str]) -> list[list[str]]:
    blocks: list[list[str]] = []
    current_block: list[str] = []
    previous_number = 0

    for item in items:
        numbered_match = NUMBERED_ITEM_RE.match(item)
        if not numbered_match:
            if current_block:
                blocks.append(current_block)
                current_block = []
                previous_number = 0
            continue

        current_number = int(numbered_match.group(1))
        if current_block and current_number <= previous_number:
            blocks.append(current_block)
            current_block = []

        current_block.append(item)
        previous_number = current_number

    if current_block:
        blocks.append(current_block)

    return blocks


def classify_block(items: list[str]) -> str:
    scores = {"zh": 0, "pinyin": 0, "vi": 0}
    for item in items:
        scores[classify_paragraph(item)] += 1

    return max(scores, key=lambda key: (scores[key], len(items)))


def select_items_for_type(items: list[str], expected_type: str) -> list[str]:
    numbered_blocks = group_numbered_blocks(items)
    matching_blocks = [
        [clean_item(item) for item in block]
        for block in numbered_blocks
        if classify_block(block) == expected_type
    ]

    if matching_blocks:
        return max(matching_blocks, key=len)

    return [clean_item(item) for item in items if classify_paragraph(item) == expected_type]


def update_manifest(content_root: Path, material_relative: str, deck_relative: str) -> None:
    manifest_path = content_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    def merge_sorted(items: list[str], value: str) -> list[str]:
        merged = sorted(set([*items, value]))
        return merged

    manifest["generatedAt"] = now_iso()
    manifest["materials"] = merge_sorted(manifest.get("materials", []), material_relative)
    manifest["publishedDecks"] = merge_sorted(manifest.get("publishedDecks", []), deck_relative)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def build_payloads(source_path: Path) -> tuple[dict, dict]:
    paragraphs = read_docx_paragraphs(source_path)
    title = paragraphs[0] if paragraphs else source_path.stem
    slug = slugify(source_path.stem)
    material_id = f"material-{slug}"
    deck_id = f"deck-{slug}"

    week_groups: list[tuple[str, list[str]]] = []
    current_heading = "Nội dung"
    current_items: list[str] = []

    for paragraph in paragraphs[1:]:
        if WEEK_RE.match(paragraph):
            if current_items:
                week_groups.append((current_heading, current_items))
            current_heading = paragraph
            current_items = []
            continue
        current_items.append(paragraph)

    if current_items:
        week_groups.append((current_heading, current_items))

    cards: list[dict] = []
    sections: list[dict] = []
    seen_card_ids_by_hanzi: dict[str, str] = {}

    for heading, items in week_groups:
        zh_items = select_items_for_type(items, "zh")
        pinyin_items = select_items_for_type(items, "pinyin")
        vi_items = select_items_for_type(items, "vi")

        pair_count = max(len(zh_items), len(pinyin_items), len(vi_items))

        section_segments: list[dict] = []
        section_zh_lines: list[str] = []
        section_pinyin_lines: list[str] = []
        section_vi_lines: list[str] = []
        section_focus_ids: list[str] = []

        for index in range(pair_count):
            zh_text = zh_items[index].strip() if index < len(zh_items) else ""
            if not zh_text:
                continue

            pinyin_text = pinyin_items[index].strip() if index < len(pinyin_items) else ""
            if not pinyin_text:
                pinyin_text = render_text_pinyin(zh_text)

            vi_text = vi_items[index].strip() if index < len(vi_items) else ""
            if not vi_text:
                vi_text = translate_zh_to_vi(zh_text)

            existing_card_id = seen_card_ids_by_hanzi.get(zh_text)
            card_id = existing_card_id or stable_id("card", f"{heading}-{index + 1}-{zh_text}")

            if not existing_card_id:
                seen_card_ids_by_hanzi[zh_text] = card_id
                cards.append(
                    {
                        "id": card_id,
                        "deckId": deck_id,
                        "hanzi": zh_text,
                        "pinyin": pinyin_text,
                        "meaningVi": vi_text,
                        "exampleZh": zh_text,
                        "examplePinyin": pinyin_text,
                        "exampleVi": vi_text,
                        "audioText": zh_text,
                        "tags": ["docx", heading],
                    }
                )

            display_index = f"{index + 1}. "
            section_segments.append({"text": display_index})
            section_segments.append({"text": zh_text, "cardId": card_id})
            section_segments.append({"text": "\n"})
            section_zh_lines.append(f"{display_index}{zh_text}")
            if pinyin_text:
                section_pinyin_lines.append(f"{display_index}{pinyin_text}")
            if vi_text:
                section_vi_lines.append(f"{display_index}{vi_text}")
            section_focus_ids.append(card_id)

        if not section_zh_lines:
            continue

        sections.append(
            {
                "id": stable_id("section", heading),
                "heading": heading,
                "textZh": "\n".join(section_zh_lines),
                "textPinyin": "\n".join(section_pinyin_lines),
                "textVi": "\n".join(section_vi_lines),
                "focusCardIds": section_focus_ids,
                "segments": section_segments[:-1] if section_segments else [],
            }
        )

    material = {
        "id": material_id,
        "title": title,
        "type": "text",
        "originPath": str(source_path).replace("\\", "/"),
        "language": "zh-CN",
        "importedAt": now_iso(),
        "ocrMode": "manual",
        "summary": "Bài đọc nhập từ DOCX với cấu trúc tiếng Trung, pinyin và nghĩa tiếng Việt theo tuần.",
        "tags": ["docx", "ôn dịch viết", "writing-practice"],
        "linkedDeckIds": [deck_id],
        "sections": sections,
    }
    deck = {
        "id": deck_id,
        "title": title,
        "description": "Deck tạo từ file DOCX ôn dịch viết, giữ nguyên cặp câu Trung - pinyin - nghĩa Việt.",
        "level": "Mixed",
        "materialId": material_id,
        "createdAt": now_iso(),
        "tags": ["docx", "ôn dịch viết", "writing-practice"],
        "cards": cards,
    }
    return material, deck


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a DOCX study pack into Hanzi Lens content JSON.")
    parser.add_argument("source", type=Path, help="Path to the DOCX file")
    parser.add_argument(
        "--content-root",
        type=Path,
        default=Path("web/public/content"),
        help="Content root containing materials/, published/ and manifest.json",
    )
    args = parser.parse_args()

    source_path = args.source.resolve()
    content_root = args.content_root.resolve()

    material, deck = build_payloads(source_path)

    material_path = content_root / "materials" / f"{material['id']}.json"
    deck_path = content_root / "published" / f"{deck['id']}.json"

    material_path.write_text(json.dumps(material, ensure_ascii=False, indent=2), encoding="utf-8")
    deck_path.write_text(json.dumps(deck, ensure_ascii=False, indent=2), encoding="utf-8")
    update_manifest(
        content_root,
        f"content/materials/{material_path.name}",
        f"content/published/{deck_path.name}",
    )

    print(f"Material JSON: {material_path}")
    print(f"Published deck JSON: {deck_path}")
    print(f"Cards: {len(deck['cards'])}")


if __name__ == "__main__":
    main()
