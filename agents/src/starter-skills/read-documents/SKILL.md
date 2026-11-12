---
name: read-documents
description: Read office files and PDFs the person attached: docx, pptx, xlsx, csv, pdf. Use when a document or deck or sheet is mentioned.
---
docx, pptx and xlsx are zip files: list them with `unzip -l`, then read the XML (word/document.xml, ppt/slides/slideN.xml, xl/sharedStrings.xml) with `unzip -p`.
csv: read it directly. pdf: try `pdftotext` and say if it is not installed.
Say plainly which parts you could read and which you could not (images, charts, scanned pages). Do not guess at unread content.
