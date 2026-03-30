// utils/pdfGenerator.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generates a branded PDF Invoice for Leodoes It
 */
const generateInvoicePDF = (invoiceData, outputPath) => {
    return new Promise((resolve, reject) => {
        try {
            // Create a new PDF document
            const doc = new PDFDocument({ margin: 50 });
            
            // Pipe the PDF into a temporary file on your server
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            // --- HEADER ---
            doc.fillColor('#4F46E5').fontSize(24).text('Leodoes It', 50, 50);
            doc.fillColor('#6B7280').fontSize(10).text('Automated Billing & IT Solutions', 50, 80);
            
            doc.fillColor('#111827').fontSize(20).text('INVOICE', 400, 50, { align: 'right' });
            doc.fontSize(10).text(`Invoice Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
            doc.text(`Billing Period: ${invoiceData.billingPeriod}`, { align: 'right' });
            
            doc.moveDown(3);

            // --- BILL TO ---
            doc.fillColor('#374151').fontSize(12).text('BILL TO:', 50, doc.y);
            doc.fillColor('#111827').fontSize(14).text(invoiceData.clientName || 'Prime Vendor / Client', 50, doc.y + 5);
            
            doc.moveDown(3);

            // --- TABLE HEADER ---
            const tableTop = doc.y;
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#4B5563');
            doc.text('DESCRIPTION', 50, tableTop);
            doc.text('HOURS', 300, tableTop);
            doc.text('RATE', 400, tableTop);
            doc.text('TOTAL', 500, tableTop);
            
            // Draw a line under the header
            doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#E5E7EB').stroke();
            
            // --- TABLE ROW (The Data) ---
            const rowTop = tableTop + 25;
            doc.font('Helvetica').fontSize(12).fillColor('#111827');
            doc.text(`Contractor Services: ${invoiceData.contractorName}`, 50, rowTop);
            doc.text(invoiceData.hours.toString(), 300, rowTop);
            doc.text(`$${invoiceData.billingRate.toFixed(2)}`, 400, rowTop);
            
            // The Math!
            const lineTotal = invoiceData.hours * invoiceData.billingRate;
            doc.text(`$${lineTotal.toFixed(2)}`, 500, rowTop);

            doc.moveDown(4);

            // --- TOTALS ---
            doc.font('Helvetica-Bold').fontSize(16).fillColor('#10B981');
            doc.text(`TOTAL DUE: $${lineTotal.toFixed(2)}`, 350, doc.y, { align: 'right' });

            // --- FOOTER ---
            doc.font('Helvetica').fontSize(10).fillColor('#9CA3AF');
            doc.text('Thank you for your business!', 50, 700, { align: 'center' });

            // Finalize the PDF
            doc.end();

            // When the file is finished saving, resolve the promise!
            stream.on('finish', () => resolve(outputPath));
            stream.on('error', reject);

        } catch (error) {
            reject(error);
        }
    });
};

module.exports = { generateInvoicePDF };