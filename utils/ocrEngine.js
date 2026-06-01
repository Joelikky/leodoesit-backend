// utils/ocrEngine.js

const XLSX = require('xlsx');

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
      // PDF OCR FAILOVER VIA LIGHTWEIGHT CLOUD FETCH
      // =====================================
      if (!extractedText || extractedText.trim().length === 0) {
        console.log("⚠️ PDF text layer empty. Activating high-speed Cloud OCR gateway...");
        extractedText = await callCloudOCR(fileBuffer, 'application/pdf');
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
      console.log("[OCR IMAGE MODE] Dispatching buffer payload to Cloud OCR...");
      extractedText = await callCloudOCR(fileBuffer, mimeType);
    }

    if (!extractedText) {
      return null;
    }

    return parseHoursFromText(extractedText);

  } catch (error) {
    console.error("OCR Extraction Failed smoothly without crashing server:", error);
    return null;
  }
};

/**
 * Zero-dependency Cloud OCR engine fallback helper
 */
async function callCloudOCR(fileBuffer, mimeType) {
  try {
    const base64File = fileBuffer.toString('base64');
    const dataURI = `data:${mimeType};base64,${base64File}`;

    const formData = new URLSearchParams();
    formData.append('base64Image', dataURI);
    formData.append('apikey', process.env.OCR_SPACE_API_KEY || 'dontshareyourkey');
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('scale', 'true');

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const result = await response.json();
    
    if (result.ParsedResults && result.ParsedResults[0]) {
      const textOutput = result.ParsedResults[0].ParsedText;
      console.log("=========================================");
      console.log("[CLOUD OCR SUCCESSFUL TEXT PAYLOAD DUMP]:");
      console.log(textOutput);
      console.log("=========================================");
      return textOutput;
    }
    
    console.warn("Cloud OCR returned an empty response structure:", result);
    return "";
  } catch (err) {
    console.error("Cloud OCR API fetching error channel broke down:", err.message);
    return "";
  }
}

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
      if (value >= 4 && value <= 60) {
        aggregatedSum += value;
        console.log(`[OCR Row Matched] Extracted line value: ${value} hrs (Current running sum: ${aggregatedSum})`);
      }
    }
  }

  if (aggregatedSum > 0 && aggregatedSum <= 200) {
    console.log(`[OCR Processing Complete] Combined calculation output: ${aggregatedSum} hrs`);
    return aggregatedSum;
  }

  return null;
}

module.exports = {
  extractHoursFromAttachment
};