'use strict';

// Two-stage PDF text extraction:
//   1. pdf-parse (fast, no OCR) — works on text-based PDFs
//   2. pdfjs-dist + canvas render → tesseract.js OCR — fallback for image-based PDFs

const pdfParse = require('pdf-parse');

async function extractText(buffer) {
  // Stage 1: try direct text extraction
  try {
    const data = await pdfParse(buffer);
    if (data.text && data.text.trim().length > 20) {
      return { text: data.text, method: 'text' };
    }
  } catch (_) { /* fall through */ }

  // Stage 2: render pages to images and OCR
  return ocrPdf(buffer);
}

async function ocrPdf(buffer) {
  const pdfjsLib  = require('pdfjs-dist/legacy/build/pdf.js');
  const { createCanvas } = require('canvas');
  const Tesseract = require('tesseract.js');

  // Silence pdfjs worker warnings
  pdfjsLib.GlobalWorkerOptions.workerSrc = false;

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (e) {
    return { text: '', method: 'ocr-failed', error: e.message };
  }

  // Create one persistent worker for all pages (faster than one per page)
  const worker = await Tesseract.createWorker('eng', 1, { logger: () => {} });

  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page     = await doc.getPage(i);
    // Scale 2.5x — higher resolution improves Tesseract accuracy on small text
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas   = createCanvas(viewport.width, viewport.height);
    const ctx      = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const imgBuf = canvas.toBuffer('image/png');
    const { data: { text } } = await worker.recognize(imgBuf);
    fullText += text + '\n';
  }

  await worker.terminate();

  return { text: fullText, method: 'ocr' };
}

module.exports = { extractText };
