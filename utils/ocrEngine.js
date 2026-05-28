// utils/ocrEngine.js

const { createWorker } = require('tesseract.js');
const XLSX = require('xlsx');

/**
 * Create Vercel-safe OCR worker
 */
const createSafeWorker = async () => {
  const worker = await createWorker('eng', 1, {
    // =========================
    // VERCEL SAFE WORKER PATH
    // =========================
    workerPath: 'https://unpkg.com/tesseract.js@5.0.4/dist/worker.min.js',

    // =========================
    // VERCEL SAFE WASM CORE
    // =========================
    corePath: 'https://unpkg.com/tesseract.js-core@5.0.0/tesseract-core.wasm.js',

    // =========================
    // LANGUAGE FILES
    // =========================
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',

    // =========================
    // DEBUG LOGGER
    // =========================
    logger: m => console.log(m),

    cacheMethod: 'readOnly',
    gzip: false,

    // =========================================================================
    // 🔥 VERCEL ENVIRONMENTAL OVERRIDES
    // =========================================================================
    legacyCore: true,   // Forces standard JS-WASM fallbacks (Bypasses missing relaxedsimd.wasm binaries)
    legacyLang: true    // Normalizes language translation memory buffers inside ephemeral nodes
  });

  return worker;
};

/**
 * Extract hours from uploaded files
 */
const extractHoursFromAttachment = async (fileBuffer, mimeType) => {
  try {
    let extractedText = '';

    // =====================================
    // 1. EXCEL FILES
    // =====================================
    if (
      mimeType.includes('sheet') ||
      mimeType.includes('excel') ||
      mimeType.includes('officedocument.spreadsheetml')
    ) {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        extractedText += XLSX.utils.sheet_to_txt(sheet) + '\n';
      });
    }

    // =====================================
    // 2. PDF FILES
    // =====================================
    else if (mimeType === 'application/pdf') {
      console.log("[PDF Processing] Reconstructing grid matrix positions via pdfreader...");

      const { PdfReader } = require('pdfreader');

      extractedText = await new Promise((resolve, reject) => {
        let rows = {};

        new PdfReader().parseBuffer(fileBuffer, (err, item) => {
          if (err) {
            reject(err);
          } else if (!item) {
            let fullText = "";
            const sortedYKeys = Object.keys(rows).sort((a, b) => parseFloat(a) - parseFloat(b));

            sortedYKeys.forEach(y => {
              const rowLine = rows[y]
                .sort((a, b) => a.x - b.x)
                .map(el => el.text)
                .join(" ");

              fullText += rowLine + "\n";
            });

            resolve(fullText);
          } else if (item.text) {
            const yNormalized = Math.round(item.y * 2) / 2;

            if (!rows[yNormalized]) {
              rows[yNormalized] = [];
            }

            rows[yNormalized].push({
              text: item.text,
              x: item.x
            });
          }
        });
      });

      // =====================================
      // PDF OCR FAILOVER GATEWAY
      // =====================================
      if (!extractedText || extractedText.trim().length === 0) {
        console.log("⚠️ PDF text layer empty. Activating Tesseract OCR failover stream...");

        const worker = await createSafeWorker();
        const { data: { text } } = await worker.recognize(fileBuffer);
        extractedText = text;
        await worker.terminate();

        console.log("=========================================");
        console.log("[OCR FAILOVER EXTRACTED TEXT DUMP]:");
        console.log(extractedText);
        console.log("=========================================");
      } else {
        console.log("=========================================");
        console.log("[OCR MATRIX NORMALIZATION DUMP]:");
        console.log(extractedText);
        console.log("=========================================");
      }
    }

    // =====================================
    // 3. IMAGE FILES
    // =====================================
    else if (mimeType.startsWith('image/')) {
      console.log("[OCR IMAGE MODE] Initializing cloud-safe worker paths...");

      const worker = await createSafeWorker();
      const { data: { text } } = await worker.recognize(fileBuffer);
      extractedText = text;
      await worker.terminate();

      console.log("=========================================");
      console.log("[OCR IMAGE TEXT DUMP]:");
      console.log(extractedText);
      console.log("=========================================");
    }

    // Nothing extracted
    if (!extractedText) {
      return null;
    }

    // Parse extracted text to isolate metric aggregates
    return parseHoursFromText(extractedText);

  } catch (error) {
    console.error("OCR Extraction Failed smoothly without crashing server:", error);
    return null;
  }
};

/**
 * Parse hours intelligently
 */
function parseHoursFromText(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);

  // =====================================
  // PASS 1: EXPLICIT TOTALS
  // =====================================
  const explicitTotalRegexes = [
    /(?:total\s*hours|total|hours\s*worked)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*(?:total\s*hours|total\s*hrs)/i
  ];

  for (const line of lines) {
    for (const regex of explicitTotalRegexes) {
      const match = line.match(regex);
      if (match && match[1]) {
        const foundHours = parseFloat(match[1]);
        if (foundHours > 0 && foundHours <= 200) {
          console.log(`[OCR Pass 1 Match] Found explicit summary hours value: ${foundHours}`);
          return foundHours;
        }
      }
    }
  }

  // =====================================
  // PASS 2: ROW SUMMATION
  // =====================================
  console.log("[OCR Pass 2 Initiated] Explicit total row missing. Running line-item extraction...");
  let aggregatedSum = 0;

  const looseRowRegex = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)?/i;

  for (const line of lines) {
    // Ignore lines that contain date ranges, URLs, or table headers to avoid counting dates as hours
    if (
      line.includes('/') ||
      line.includes('-') ||
      line.toLowerCase().includes('billing')
    ) {
      continue;
    }

    const cleanLine = line.replace(/[()\[\]]/g, '');
    const match = cleanLine.match(looseRowRegex);

    if (match && match[1]) {
      const value = parseFloat(match[1]);
      // Only aggregate typical weekly increments (between 4 and 60 hours per row entry)
      if (value >= 4 && value <= 60) {
        aggregatedSum += value;
        console.log(`[OCR Row Matched] Extracted line value: ${value} hrs (Current running sum: ${aggregatedSum})`);
      }
    }
  }

  // =====================================
  // FINAL VALIDATION BOUNDARY GATE
  // =====================================
  if (aggregatedSum > 0 && aggregatedSum <= 200) {
    console.log(`[OCR Processing Complete] Combined calculation output: ${aggregatedSum} hrs`);
    return aggregatedSum;
  }

  return null;
}

module.exports = {
  extractHoursFromAttachment
};