# Hanzi Lens

Website học tiếng Trung `flashcard-first`, host tĩnh trên `GitHub Pages`, với pipeline local để OCR và trích xuất tài liệu thành draft flashcard.

## Cấu trúc

- `web/`: frontend `React + Vite + TypeScript`
- `web/public/content/`: JSON versioned cho `materials`, `drafts`, `published`
- `pipeline/`: CLI local để ingest tài liệu và export deck
- `materials/`: nơi nên đặt PDF/TXT nguồn trước khi ingest

## Chạy frontend

```powershell
cd .\web
npm install
npm run dev
```

Build production:

```powershell
cd .\web
npm run build
```

## Chạy pipeline local

```powershell
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
py -3 -m pip install -U pip
py -3 -m pip install -e .\pipeline
ingest-material ".\Dịch nói bài đọc thêm.pdf" --content-root ".\web\public\content" --ollama-model "qwen2.5:7b"
```

Nếu cần tốc độ (không OCR):

```powershell
ingest-material ".\Dịch nói bài đọc thêm.pdf" --content-root ".\web\public\content" --no-ocr --topic "benh-vien"
```

Export published deck từ draft:

```powershell
export-published ".\web\public\content\drafts\draft-dich-noi-bai-doc-them.json" --output-root ".\web\public\content"
```

Gộp thêm từ vào deck cùng chủ đề hiện có:

```powershell
export-published ".\web\public\content\drafts\draft-dich-noi-bai-doc-them.json" --output-root ".\web\public\content" --merge-with ".\web\public\content\published\deck-hospital-route.json"
```

## Quy ước dữ liệu

- `materials/*.json`: bài đọc gốc cho Reader
- `drafts/*.json`: deck nháp do pipeline sinh ra, để duyệt ở tab `Drafts`
- `published/*.json`: deck chính thức dùng cho tab `Review`
- `StudyRecord`: tiến độ ôn tập lưu trong `IndexedDB`, không commit vào repo

## Deploy GitHub Pages

Workflow tại `.github/workflows/deploy-pages.yml` sẽ:

1. cài dependencies trong `web/`
2. chạy `npm run build`
3. publish `web/dist` lên `GitHub Pages`

Vì app dùng `base: './'` và không dùng router phía server, bạn không cần chỉnh thêm cấu hình route.
