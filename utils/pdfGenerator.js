const puppeteer = require('puppeteer');

/**
 * Generates an Invoice PDF and returns it as a Memory Buffer
 * @param {Object} data - The invoice data
 * @returns {Buffer} - The raw PDF data ready for S3 upload
 */
const generateInvoiceBuffer = async (data) => {
    // 1. Determine which company layout to use
    const isGandiva = data.companyName.toLowerCase().includes('gandiva');
    
    // 2. Formatting & Calculations
    const rawAmount = parseFloat(data.hours) * parseFloat(data.billingRate);
    const formattedAmount = rawAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedRate = parseFloat(data.billingRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
    const invoiceDateStr = data.invoiceDate || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const dueDateStr = data.dueDate || '';
    const netTermsStr = data.netTerms || 'Net 30';
    const netDays = data.netTerms ? data.netTerms.replace(/\D/g, '') : '30';

    let htmlContent = '';

    // ==========================================
    // 🎨 GANDIVA INSIGHTS TEMPLATE (Black Boxes)
    // ==========================================
    if (isGandiva) {
        htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: 'Arial', sans-serif; padding: 40px; color: #000; font-size: 14px; line-height: 1.4; }
                .header-flex { display: flex; justify-content: space-between; align-items: flex-start; }
                .company-name { font-size: 20px; font-weight: bold; margin-bottom: 5px; }
                .invoice-title-box { text-align: left; }
                .invoice-title { font-size: 24px; font-weight: bold; letter-spacing: 1px; margin-bottom: 15px; }
                .to-for-flex { display: flex; justify-content: space-between; margin-top: 50px; margin-bottom: 40px; }
                .to-box { width: 60%; }
                .for-box { width: 40%; }
                table.main-table { width: 100%; border-collapse: collapse; border: 2px solid #000; }
                table.main-table th { border-bottom: 1px solid #000; border-right: 1px solid #000; padding: 10px; text-align: left; font-weight: bold; }
                table.main-table td { border-right: 1px solid #000; padding: 12px 10px; vertical-align: top; height: 150px; }
                table.main-table th:last-child, table.main-table td:last-child { border-right: none; }
                .center-text { text-align: center !important; }
                .left-text { text-align: left !important; }
                table.total-table { width: 100%; border-collapse: collapse; }
                table.total-table td { padding: 10px; }
                .empty-bottom { border-top: 2px solid #000; }
                .total-label { border: 1px solid #000; border-bottom: 2px solid #000; font-weight: bold; text-align: center; }
                .total-amount { border: 1px solid #000; border-bottom: 2px solid #000; border-right: 2px solid #000; font-weight: bold; }
                .footer { margin-top: 50px; }
                .thanks-text { margin-top: 40px; margin-left: 50%; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="header-flex">
                <div>
                    <div class="company-name">GANDIVA INSIGHTS</div>
                    <div>accounts@gandivainsights.com<br/>Gandivainsights.com<br/>Houston, TX | 77058</div>
                </div>
                <div class="invoice-title-box">
                    <div class="invoice-title">INVOICE</div>
                    <div>INVOICE #: ${data.invoiceNumber}<br/>DATE: ${invoiceDateStr}</div>
                </div>
            </div>
            <div class="to-for-flex">
                <div class="to-box">
                    <strong>TO:</strong><br/>${data.clientName}<br/>${data.clientAddress ? data.clientAddress.replace(/\\n/g, '<br/>') : ''}
                </div>
                <div class="for-box">
                    <strong>FOR:</strong><br/>${data.vendorFor !== 'N/A' && data.vendorFor ? data.vendorFor : ''}
                </div>
            </div>
            <table class="main-table">
                <colgroup><col style="width: 50%;"><col style="width: 15%;"><col style="width: 15%;"><col style="width: 20%;"></colgroup>
                <thead>
                    <tr><th>DESCRIPTION</th><th class="center-text">HOURS</th><th class="left-text">RATE</th><th class="left-text">AMOUNT</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${data.contractorName} ${data.role} (${data.billingPeriod})</td>
                        <td class="center-text">${data.hours}</td>
                        <td class="left-text">$${formattedRate}</td>
                        <td class="left-text">$${formattedAmount}</td>
                    </tr>
                </tbody>
            </table>
            <table class="total-table">
                <colgroup><col style="width: 50%;"><col style="width: 15%;"><col style="width: 15%;"><col style="width: 20%;"></colgroup>
                <tbody>
                    <tr>
                        <td colspan="2" class="empty-bottom"></td>
                        <td class="total-label">TOTAL</td>
                        <td class="total-amount">$${formattedAmount}</td>
                    </tr>
                </tbody>
            </table>
            <div class="footer">
                <p>Make all checks payable to: GANDIVA INSIGHTS (Payable net ${netDays})</p>
                <p class="thanks-text">Thank you for your business!</p>
            </div>
        </body>
        </html>
        `;
    } 
    
    // ==========================================
    // 🎨 LEO DOES IT TEMPLATE (Sleek Blue Style)
    // ==========================================
    else {
        htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 50px 40px; color: #333; font-size: 13px; line-height: 1.5; }
                
                /* Header */
                .header { display: flex; justify-content: space-between; margin-bottom: 50px; align-items: flex-start; }
                .company-name { font-size: 18px; font-weight: bold; color: #000; margin-bottom: 5px; }
                .company-address { color: #555; font-size: 12px; }
                .invoice-title-wrapper { text-align: right; }
                .invoice-title { font-size: 40px; color: #2874A6; margin: 0; font-weight: normal; }
                .invoice-num { font-size: 14px; font-weight: bold; color: #000; margin-top: 5px; }

                /* Meta Details */
                .meta-section { display: flex; justify-content: space-between; margin-bottom: 40px; align-items: flex-end; }
                .bill-to-title { font-size: 16px; font-weight: bold; margin-bottom: 5px; color: #000; }
                .bill-to-name { color: #333; }
                .dates-table { border-collapse: collapse; text-align: right; font-size: 13px; }
                .dates-table td { padding: 4px 0 4px 20px; }
                .dates-label { color: #555; }
                .dates-value { color: #000; }

                /* Subject Details */
                .subject-section { margin-bottom: 30px; }
                .subject-title { font-weight: bold; font-size: 15px; color: #000; margin-bottom: 5px; }
                .subject-text { color: #333; margin-bottom: 15px; }

                /* Main Table */
                .main-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                .main-table th { background-color: #2874A6; color: #fff; padding: 12px; text-align: left; font-weight: normal; font-size: 12px; }
                .main-table td { padding: 15px 12px; border-bottom: 1px solid #ddd; color: #333; }
                .center-col { text-align: center !important; }
                .right-col { text-align: right !important; }

                /* Totals Section */
                .totals-container { display: flex; justify-content: flex-end; margin-top: 10px; }
                .totals-table { width: 350px; border-collapse: collapse; }
                .totals-table td { padding: 12px; text-align: right; font-size: 13px; }
                .bold-text { font-weight: bold; color: #000; }
                .balance-row td { background-color: #F4F6F6; font-weight: bold; color: #000; }

                /* Footer */
                .notes-section { margin-top: 60px; }
                .notes-title { font-size: 15px; color: #000; margin-bottom: 5px; }
                .notes-text { color: #555; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div class="company-name">Leo Does IT Inc.</div>
                    <div class="company-address">1335 Regents Park Dr, Suite# 270.<br/>Houston, Texas 77058.</div>
                </div>
                <div class="invoice-title-wrapper">
                    <h1 class="invoice-title">Invoice</h1>
                    <div class="invoice-num"># LDI-${data.invoiceNumber}</div>
                </div>
            </div>

            <div class="meta-section">
                <div>
                    <div class="bill-to-title">To</div>
                    <div class="bill-to-name">${data.clientName}<br/>${data.clientAddress ? data.clientAddress.replace(/\\n/g, '<br/>') : ''}</div>
                </div>
                <div>
                    <table class="dates-table">
                        <tr><td class="dates-label">Invoice Date:</td><td class="dates-value">${invoiceDateStr}</td></tr>
                        <tr><td class="dates-label">Terms:</td><td class="dates-value">${netTermsStr}</td></tr>
                        <tr><td class="dates-label">Due Date:</td><td class="dates-value">${dueDateStr}</td></tr>
                    </table>
                </div>
            </div>

            <div class="subject-section">
                <div class="subject-title">Client / End Client</div>
                <div class="subject-text">${data.clientName} ${data.vendorFor !== 'N/A' && data.vendorFor ? '/ ' + data.vendorFor : ''}</div>
                
                <div style="margin-top: 20px;">
                    <span style="color: #555;">Subject :</span><br/>
                    <span style="color: #333;">For ${data.contractorName}, ${data.role}</span>
                </div>
            </div>

            <table class="main-table">
                <thead>
                    <tr>
                        <th style="width: 5%; text-align: center;">#</th>
                        <th style="width: 45%;">Item & Description</th>
                        <th style="width: 15%;" class="right-col">Qty</th>
                        <th style="width: 15%;" class="right-col">Rate</th>
                        <th style="width: 20%;" class="right-col">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="center-col">1</td>
                        <td>Time Period: ${data.billingPeriod}</td>
                        <td class="right-col">${data.hours}</td>
                        <td class="right-col">$${formattedRate}</td>
                        <td class="right-col">$${formattedAmount}</td>
                    </tr>
                </tbody>
            </table>

            <div class="totals-container">
                <table class="totals-table">
                    <tr>
                        <td>Sub Total</td>
                        <td>$${formattedAmount}</td>
                    </tr>
                    <tr>
                        <td class="bold-text">Total</td>
                        <td class="bold-text">$${formattedAmount}</td>
                    </tr>
                    <tr class="balance-row">
                        <td>Balance Due</td>
                        <td>$${formattedAmount}</td>
                    </tr>
                </table>
            </div>

            <div class="notes-section">
                <div class="notes-title">Notes</div>
                <div class="notes-text">Thanks for your business.</div>
            </div>
        </body>
        </html>
        `;
    }

    // 3. Generate the PDF Document in Memory
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // By removing the `path` option, Puppeteer returns the PDF as a Buffer!
    const pdfBuffer = await page.pdf({ 
        format: 'A4', 
        printBackground: true
    });
    
    await browser.close();
    
    return pdfBuffer;
};

module.exports = { generateInvoiceBuffer };