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
 * Parse hours intelligently with Multi-Page Aggregation support
 */
function parseHoursFromText(text) {
  // =========================================================================
  // PASS 1: TARGETED KEYWORD-TRAILING NUMBER EXTRACTOR
  // Isolates exact numbers trailing the standalone "Total" matrix token.
  // =========================================================================
  const targetTotalRegex = /\bTotal\b\s*[:=\-_]?\s*\b(\d+(?:\.\d+)?)\b/gi;
  
  // CRITICAL FIX: Reset the global execution index to index position 0 
  // on every subsequent function initialization invocation.
  targetTotalRegex.lastIndex = 0;

  let accumulatedTotalHours = 0;
  let hasFoundExplicitTotals = false;
  let match;

  // Scan the entire text stream globally for individual instances of "Total XX.XX"
  while ((match = targetTotalRegex.exec(text)) !== null) {
    if (match[1]) {
      const foundHours = parseFloat(match[1]);
      
      // Ensure values correspond to valid individual weekly limits (between 4 and 60 hours)
      if (foundHours >= 4 && foundHours <= 60) {
        accumulatedTotalHours += foundHours;
        hasFoundExplicitTotals = true;
        console.log(`[OCR Multi-Page Tracer] Found sheet total item: +${foundHours} hrs (Running total: ${accumulatedTotalHours})`);
      }
    }
  }

  // Cap validation threshold up to 250 total monthly hours to catch large sums safely
  if (hasFoundExplicitTotals && accumulatedTotalHours > 0 && accumulatedTotalHours <= 250) {
    console.log(`[OCR Aggregator Complete] Combined Document Output Matrix: ${accumulatedTotalHours} hrs`);
    return accumulatedTotalHours;
  }

  // =========================================================================
  // PASS 2: ROW SUMMATION FALLBACK (STRICT BOUNDARY SECURITY)
  // Runs if no explicit total labels are captured in the file layer text structure.
  // =========================================================================
  console.log("[OCR Pass 2 Initiated] Explicit total rows missing. Running line-item extraction...");
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  let aggregatedSum = 0;
  const looseRowRegex = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)?(?:\s|$)/i;

  for (const line of lines) {
    if (
      line.includes('/') ||
      line.includes('-') ||
      line.includes(':') ||
      line.toLowerCase().includes('billing') ||
      line.toLowerCase().includes('invoice')
    ) {
      continue;
    }

    const cleanLine = line.replace(/[()\[\]]/g, '');
    const match = cleanLine.match(looseRowRegex);

    if (match && match[1]) {
      const value = parseFloat(match[1]);
      if (value >= 4 && value <= 60) {
        aggregatedSum += value;
        console.log(`[OCR Row Fallback Matched] Line value: ${value} hrs (Current sum: ${aggregatedSum})`);
      }
    }
  }

  if (aggregatedSum > 0 && aggregatedSum <= 250) {
    console.log(`[OCR Processing Complete] Combined row calculation output: ${aggregatedSum} hrs`);
    return aggregatedSum;
  }

  return null;
}

module.exports = {
  extractHoursFromAttachment
};