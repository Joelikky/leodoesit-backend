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

function parseHoursFromText(text) {
  console.log("===== OCR PARSER V3 DEPLOYED =====");

  // ==========================================================
  // PRIMARY MODE
  // Sum hours from date rows
  // Example:
  // 3/2/2026 8.00
  // 3/10/2026 0.00
  // ==========================================================

  const dateHourRegex =
    /\b\d{1,2}\/\d{1,2}\/\d{4}\s+(\d+(?:\.\d+)?)\b/g;

  let match;
  let totalHours = 0;
  let matchedRows = 0;

  while ((match = dateHourRegex.exec(text)) !== null) {
    const hours = parseFloat(match[1]);

    if (!isNaN(hours) && hours >= 0 && hours <= 24) {
      totalHours += hours;
      matchedRows++;

      console.log(
        `[OCR Date Row] +${hours} hrs (Running Total: ${totalHours})`
      );
    }
  }

  if (matchedRows > 0) {
    console.log(
      `[OCR Aggregation Complete] ${matchedRows} rows => ${totalHours} hrs`
    );

    return totalHours;
  }

  // ==========================================================
  // FALLBACK MODE
  // If OCR formatting breaks dates, look for all hour values
  // ==========================================================

  console.log(
    "[OCR Fallback] Date rows not found. Running numeric extraction..."
  );

  const hourRegex = /\b(?:0|4|8|10|12|16|20|24)\.00\b/g;

  let fallbackTotal = 0;
  let fallbackCount = 0;

  while ((match = hourRegex.exec(text)) !== null) {
    const hours = parseFloat(match[0]);

    fallbackTotal += hours;
    fallbackCount++;
  }

  if (fallbackCount > 0 && fallbackTotal <= 400) {
    console.log(
      `[OCR Fallback Complete] ${fallbackCount} values => ${fallbackTotal} hrs`
    );

    return fallbackTotal;
  }

  console.warn(
    "[OCR Parser] Unable to determine hours from OCR output."
  );

  return null;
}
module.exports = {
  extractHoursFromAttachment
};