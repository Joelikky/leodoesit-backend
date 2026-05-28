// utils/ocrEngine.js

const { createWorker } = require('tesseract.js'); 
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
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        extractedText += XLSX.utils.sheet_to_txt(sheet) + '\n';
      });
    }
    
    // 2. Handle Document PDFs using Matrix Row Grouping
    else if (mimeType === 'application/pdf') {
      console.log("[PDF Processing] Reconstructing grid matrix positions via pdfreader...");
      
      const { PdfReader } = require('pdfreader');
      
      extractedText = await new Promise((resolve, reject) => {
        let rows = {}; // Group text elements by their vertical Y-coordinate
        
        new PdfReader().parseBuffer(fileBuffer, (err, item) => {
          if (err) {
            reject(err);
          } else if (!item) {
            // Stream complete: compile rows sorted by top-to-bottom Y index
            let fullText = "";
            const sortedYKeys = Object.keys(rows).sort((a, b) => parseFloat(a) - parseFloat(b));
            
            sortedYKeys.forEach(y => {
              // Sort tokens within the same row from left to right (X index)
              const rowLine = rows[y].sort((a, b) => a.x - b.x).map(el => el.text).join(" ");
              fullText += rowLine + "\n";
            });
            
            resolve(fullText);
          } else if (item.text) {
            // Normalize cell grid variance using an approximate Y boundary coordinate window (2 units)
            const yNormalized = Math.round(item.y * 2) / 2; 
            if (!rows[yNormalized]) {
              rows[yNormalized] = [];
            }
            rows[yNormalized].push({ text: item.text, x: item.x });
          }
        });
      });

      console.log("=========================================");
      console.log("[OCR MATRIX NORMALIZATION DUMP]:");
      console.log(extractedText);
      console.log("=========================================");
    }
    
    // 3. Handle Images (PNG, JPEG) via Cloud-Decoupled OCR Engine
    else if (mimeType.startsWith('image/')) {
      console.log("[OCR Image Target Block Activated] Initializing cloud-safe worker paths...");

      const worker = await createWorker('eng', 1, {
        workerPath: 'https://unpkg.com/tesseract.js@v5.1.0/dist/worker.min.js',
        corePath: 'https://unpkg.com/tesseract.js-core@v5.1.0/tesseract-core.wasm.js',
        logger: m => console.log(`[Tesseract Core Progress]: ${m.status} -> ${(m.progress * 100).toFixed(0)}%`)
      });

      const { data: { text } } = await worker.recognize(fileBuffer);
      extractedText = text;
      await worker.terminate();
    }

    if (!extractedText) return null;

    return parseHoursFromText(extractedText);
  } catch (error) {
    console.error("OCR Extraction loop failed smoothly without crashing server:", error.message);
    return null;
  }
};

/**
 * Advanced Regex engine that handles explicit total values OR calculates 
 * the sum of individual line item hour metrics automatically.
 */
function parseHoursFromText(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  
  // ⚡ PASS 1: Look for an explicit, pre-aggregated total row
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

  // ⚡ PASS 2: Pull and aggregate grid row blocks ("40h", "32 hrs", "40.00")
  console.log("[OCR Pass 2 Initiated] Explicit total row missing. Running line-item extraction...");
  let aggregatedSum = 0;
  
  // Captures explicit strings like "40h", or numbers matching standalone hours patterns
  const looseRowRegex = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)?/i;

  for (const line of lines) {
    // Ignore lines that contain date ranges, URLs, or table headers to avoid counting dates as hours
    if (line.includes('/') || line.includes('-') || line.toLowerCase().includes('billing')) {
      continue;
    }

    const cleanLine = line.replace(/[()\[\]]/g, ''); 
    const match = cleanLine.match(looseRowRegex);
    
    if (match && match[1]) {
      const value = parseFloat(match[1]);
      // Only aggregate typical weekly increments (e.g., between 4 and 60 hours per row entry)
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

module.exports = { extractHoursFromAttachment };