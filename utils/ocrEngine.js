// utils/ocrEngine.js

const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');

// Patched SheetJS implementation deployment package via Option 1
const XLSX = require('xlsx'); 

/**
 * Automatically parses attachment data to locate and extract total hours worked.
 * @param {Buffer} fileBuffer - Raw binary file data from multer memoryStorage
 * @param {string} mimeType - The file's MIME type string
 * @returns {Promise<number|null>} - Extracted hours value, or null if unverified
 */
const extractHoursFromAttachment = async (fileBuffer, mimeType) => {
  try {
    let extractedText = '';

    // 1. Handle Excel Sheets (.xlsx, .xls)
    if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('officedocument.spreadsheetml')) {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      
      // Concat text data from all spreadsheet columns & rows
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        extractedText += XLSX.utils.sheet_to_txt(sheet) + '\n';
      });
    }
    
    // 2. Handle Document PDFs
    else if (mimeType === 'application/pdf') {
      // 🔥 FIX: Supply a selective layout configuration object to suppress structural canvas matrix polyfills entirely
      const options = {
        pager: () => ({ text: "" }) 
      };
      
      const pdfData = await pdfParse(fileBuffer, options);
      extractedText = pdfData.text;
    }
    
    // 3. Handle Images (PNG, JPEG) via OCR Vision Engine
    else if (mimeType.startsWith('image/')) {
      const { data: { text } } = await Tesseract.recognize(fileBuffer, 'eng');
      extractedText = text;
    }

    if (!extractedText) return null;

    return parseHoursFromText(extractedText);
  } catch (error) {
    console.error("OCR Extraction loop failed:", error);
    return null;
  }
};

/**
 * Regex engine that searches raw text layouts for total hour indicators
 */
function parseHoursFromText(text) {
  // Normalize and split text lines
  const lines = text.split('\n');
  
  // High-probability keywords used on contractor timesheet templates
  const structuralRegexes = [
    /(?:total\s*hours|total|hours\s*worked|hours)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*(?:hrs|hours|total hours)/i
  ];

  for (const line of lines) {
    for (const regex of structuralRegexes) {
      const match = line.match(regex);
      if (match && match[1]) {
        const foundHours = parseFloat(match[1]);
        // Basic sanity check: return hours if they sit within standard boundaries
        if (foundHours > 0 && foundHours <= 200) {
          return foundHours;
        }
      }
    }
  }

  return null;
}

module.exports = { extractHoursFromAttachment };