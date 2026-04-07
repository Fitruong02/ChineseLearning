# Chinese Flashcards Pipeline

Pipeline local để:

- đọc `txt/md/pdf`
- OCR `pdf scan` bằng `PaddleOCR`
- tách câu và ứng viên từ vựng
- tra `CC-CEDICT`
- gọi `Ollama` để làm gọn nghĩa tiếng Việt và dịch ví dụ
- sinh `material JSON`, `draft deck JSON`, `published deck JSON`, `CSV` cho Anki

## Cài đặt

```powershell
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
py -3 -m pip install -U pip
py -3 -m pip install -e .\pipeline
```

Nếu muốn OCR, cần cài runtime `paddlepaddle` theo bản phù hợp máy Windows của bạn trước hoặc sau bước trên.

## Từ điển

Pipeline luôn có fallback `mini_cedict.u8` để demo. Để chạy thật, tải file `cedict_ts.u8` rồi đặt vào một trong các vị trí sau:

- `pipeline/resources/cedict_ts.u8`
- đường dẫn chỉ định bằng `--cedict-path`

## Chạy ingest

```powershell
ingest-material ".\Dịch nói bài đọc thêm.pdf" --content-root ".\web\public\content" --ollama-model "qwen2.5:7b"
```

Nếu muốn chạy nhanh và bỏ OCR:

```powershell
ingest-material ".\Dịch nói bài đọc thêm.pdf" --content-root ".\web\public\content" --no-ocr --topic "benh-vien"
```

Lệnh sẽ sinh:

- `web/public/content/materials/<slug>.json`
- `web/public/content/drafts/draft-<slug>.json`
- `web/public/content/manifest.json`

## Export published deck

```powershell
export-published ".\web\public\content\drafts\draft-dich-noi-bai-doc-them.json" --output-root ".\web\public\content"
```

Để gộp từ mới vào deck chủ đề đang có (không tạo deck mới):

```powershell
export-published ".\web\public\content\drafts\draft-dich-noi-bai-doc-them.json" --output-root ".\web\public\content" --merge-with ".\web\public\content\published\deck-hospital-route.json"
```

Lệnh sẽ sinh:

- `web/public/content/published/deck-<slug>.json`
- `web/public/content/published/deck-<slug>.csv`
- `web/public/content/manifest.json`

## Ghi chú

- `Ollama` là tùy chọn; nếu không có, pipeline vẫn chạy nhưng `meaningVi` và `exampleVi` chỉ là fallback thô.
- Với PDF có text-selectable, pipeline ưu tiên trích trực tiếp bằng `PyMuPDF`.
- Với PDF scan, pipeline render từng trang rồi OCR bằng `PaddleOCR`.
- Nếu PDF text-selectable và bạn ưu tiên tốc độ, dùng `--no-ocr` để tránh chờ OCR.
