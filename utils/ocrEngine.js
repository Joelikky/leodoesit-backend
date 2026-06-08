
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');

/**
 * Extract hours from uploaded files
 */
const extractHoursFromAttachment = async (fileBuffer, mimeType) => {
  try {
    let extractedText = '';

    // =====================================
    // EXCEL FILES
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
    // PDF FILES
    // =====================================
    else if (mimeType === 'application/pdf') {
      console.log('[PDF Processing] Using pdf-parse engine...');

      const pdfData = await pdfParse(fileBuffer);

      extractedText = pdfData.text || '';

      console.log('=========================================');
      console.log('[PDF PARSE TEXT DUMP]');
      console.log(extractedText);
      console.log('=========================================');
    }

    // =====================================
    // IMAGE FILES
    // =====================================
    else if (mimeType.startsWith('image/')) {
      console.log('[OCR IMAGE MODE] Dispatching buffer payload to Cloud OCR...');
      extractedText = await callCloudOCR(fileBuffer, mimeType);
    }

    if (!extractedText || !extractedText.trim()) {
      return null;
    }

    return parseHoursFromText(extractedText);

  } catch (error) {
    console.error('OCR Extraction Failed:', error);
    return null;
  }
};

/**
 * OCR.Space fallback
 */
async function callCloudOCR(fileBuffer, mimeType) {
  try {
    const base64File = fileBuffer.toString('base64');
    const dataURI = `data:${mimeType};base64,${base64File}`;

    const formData = new URLSearchParams();
    formData.append('base64Image', dataURI);
    formData.append(
      'apikey',
      process.env.OCR_SPACE_API_KEY || 'dontshareyourkey'
    );
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('scale', 'true');

    const response = await fetch(
      'https://api.ocr.space/parse/image',
      {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        }
      }
    );

    const result = await response.json();

    if (result?.ParsedResults?.[0]?.ParsedText) {
      return result.ParsedResults[0].ParsedText;
    }

    return '';
  } catch (err) {
    console.error('Cloud OCR Error:', err);
    return '';
  }
}

/**
 * Extract total hours
 */
function parseHoursFromText(text) {
  console.log('===== OCR PARSER FINAL =====');

  // Match:
  // Total 40.00
  // Total 32.00
  // Total 8.00

  const totalRegex =
    /\bTotal\s+(\d+(?:\.\d+)?)\b/gi;

  let match;
  let totalHours = 0;
  let foundTotals = 0;

  while ((match = totalRegex.exec(text)) !== null) {
    const hours = parseFloat(match[1]);

    if (hours >= 0 && hours <= 60) {
      totalHours += hours;
      foundTotals++;

      console.log(
        `[OCR Total] +${hours} hrs (Running: ${totalHours})`
      );
    }
  }

  if (foundTotals > 0) {
    console.log(
      `[OCR Complete] ${totalHours} hrs`
    );

    return totalHours;
  }

  // Fallback: sum daily rows

  const dateRowRegex =
    /\b\d{1,2}\/\d{1,2}\/\d{4}\s+(\d+(?:\.\d+)?)\b/g;

  let rowTotal = 0;

  while ((match = dateRowRegex.exec(text)) !== null) {
    const hours = parseFloat(match[1]);

    if (hours >= 0 && hours <= 24) {
      rowTotal += hours;
    }
  }

  if (rowTotal > 0) {
    return rowTotal;
  }

  return null;
}

module.exports = {
  extractHoursFromAttachment
};

