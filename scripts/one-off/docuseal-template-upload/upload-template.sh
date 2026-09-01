#!/usr/bin/env bash
#
# Programmatically upload a DOCX-with-{{tags}} into a self-hosted DocuSeal
# Community container. Works around the two Community edition limits:
#   (1) POST /api/templates/* is Pro-gated
#   (2) DOCX file type is Pro-gated (only PDF accepted)
#   (3) DocuSeal's PDF field detector looks for AcroForm fields, NOT {{tag}}
#       text patterns
#
# Flow:
#   1. Convert DOCX -> PDF via a one-shot linuxserver/libreoffice container
#   2. Copy the PDF into the DocuSeal container
#   3. Run a Rails runner script that:
#      - Uses pdfium to find every {{tag}} position in the PDF
#      - Creates a Template + Attachment via internal Rails models
#      - Injects one field record per tag (with normalized x/y/w/h + role
#        + type parsed from the tag) into template.fields JSON
#      - Groups fields by role into submitters (ContractsTeam / Vendor /
#        GeneralManager)
#
# Usage:
#   ./upload-template.sh <path-to-docx> "<template display name>"
#
# Prereqs: DocuSeal container named 'docuseal' running; Docker available.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <path-to-docx> \"<template display name>\"" >&2
  exit 1
fi

DOCX_PATH="$1"
TEMPLATE_NAME="$2"

if [[ ! -f "$DOCX_PATH" ]]; then
  echo "DOCX not found: $DOCX_PATH" >&2
  exit 1
fi

ABS_DOCX="$(cd "$(dirname "$DOCX_PATH")" && pwd)/$(basename "$DOCX_PATH")"
WORK_DIR="$(dirname "$ABS_DOCX")"
BASENAME="$(basename "$DOCX_PATH" .docx)"
PDF_PATH="$WORK_DIR/$BASENAME.pdf"

echo "==> Converting DOCX -> PDF via LibreOffice (one-shot container)"
docker run --rm \
  -v "$WORK_DIR:/data" \
  --entrypoint soffice \
  linuxserver/libreoffice:latest \
  --headless --convert-to pdf --outdir /data "/data/$(basename "$ABS_DOCX")" >/dev/null

if [[ ! -f "$PDF_PATH" ]]; then
  echo "PDF conversion failed" >&2
  exit 1
fi
echo "    PDF: $PDF_PATH ($(stat -f%z "$PDF_PATH") bytes)"

echo "==> Copying PDF into docuseal container"
docker cp "$PDF_PATH" docuseal:/tmp/upload.pdf

echo "==> Injecting template + fields via Rails runner"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker cp "$SCRIPT_DIR/inject-template.rb" docuseal:/tmp/inject-template.rb
docker exec -w /app -e TEMPLATE_NAME="$TEMPLATE_NAME" docuseal \
  bin/rails runner /tmp/inject-template.rb

echo "==> Done"
