// ✅ Production-safe Puppeteer setup for Vercel / Render
const chromium = require('@sparticuz/chromium-min');
const puppeteer = require('puppeteer-core');

/**
 * Generates an Invoice PDF and returns it as a Memory Buffer
 * @param {Object} data - The invoice data
 * @returns {Buffer} - The raw PDF data ready for S3 upload
 */
const generateInvoiceBuffer = async (data) => {
    // 1. Determine which company layout to use
    const isGandiva = data.companyName
        ?.toLowerCase()
        .includes('gandiva');

    // 2. Formatting & Calculations
    const rawAmount =
        parseFloat(data.hours || 0) *
        parseFloat(data.billingRate || 0);

    const formattedAmount = rawAmount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const formattedRate = parseFloat(
        data.billingRate || 0
    ).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    // Extract partial payment details
    const amountPaid = parseFloat(data.amountPaid || 0);
    const balanceDue = data.balanceDue !== undefined ? parseFloat(data.balanceDue) : (rawAmount - amountPaid);

    const formattedPaid = amountPaid.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const formattedBalance = balanceDue.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const invoiceDateStr =
        data.invoiceDate ||
        new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

    const dueDateStr = data.dueDate || '';
    const netTermsStr = data.netTerms || 'Net 30';

    const netDays = data.netTerms
        ? data.netTerms.replace(/\D/g, '')
        : '30';

    let htmlContent = '';

    // ==========================================
    // 🎨 GANDIVA INSIGHTS TEMPLATE
    // ==========================================
    if (isGandiva) {
        htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 40px;
                    color: #000;
                    font-size: 14px;
                    line-height: 1.4;
                }
                .header-flex {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                }
                .company-name {
                    font-size: 20px;
                    font-weight: bold;
                    margin-bottom: 5px;
                }
                .invoice-title {
                    font-size: 24px;
                    font-weight: bold;
                    margin-bottom: 15px;
                }
                .to-for-flex {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 50px;
                    margin-bottom: 40px;
                }
                .to-box {
                    width: 60%;
                }
                .for-box {
                    width: 40%;
                }
                table.main-table {
                    width: 100%;
                    border-collapse: collapse;
                    border: 2px solid #000;
                }
                table.main-table th {
                    border-bottom: 1px solid #000;
                    border-right: 1px solid #000;
                    padding: 10px;
                    text-align: left;
                    font-weight: bold;
                }
                table.main-table td {
                    border-right: 1px solid #000;
                    padding: 12px 10px;
                    vertical-align: top;
                    height: 120px;
                }
                table.main-table th:last-child,
                table.main-table td:last-child {
                    border-right: none;
                }
                .center-text {
                    text-align: center;
                }
                table.total-table {
                    width: 100%;
                    border-collapse: collapse;
                }
                .total-label {
                    border: 1px solid #000;
                    font-weight: bold;
                    text-align: center;
                    padding: 10px;
                }
                .total-amount {
                    border: 1px solid #000;
                    font-weight: bold;
                    padding: 10px;
                }
                .footer {
                    margin-top: 50px;
                }
                .thanks-text {
                    margin-top: 40px;
                    text-align: right;
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div class="header-flex">
                <div>
                    <div class="company-name">GANDIVA INSIGHTS</div>
                    <div>
                        accounts@gandivainsights.com<br/>
                        Gandivainsights.com<br/>
                        Houston, TX | 77058
                    </div>
                </div>
                <div>
                    <div class="invoice-title">INVOICE</div>
                    <div>
                        INVOICE #: ${data.invoiceNumber}<br/>
                        DATE: ${invoiceDateStr}
                    </div>
                </div>
            </div>

            <div class="to-for-flex">
                <div class="to-box">
                    <strong>TO:</strong><br/>
                    ${data.clientName || ''}<br/>
                    ${
                        data.clientAddress
                            ? data.clientAddress.replace(/\n/g, '<br/>')
                            : ''
                    }
                </div>
                <div class="for-box">
                    <strong>FOR:</strong><br/>
                    ${
                        data.vendorFor !== 'N/A' && data.vendorFor
                            ? data.vendorFor
                            : ''
                    }
                </div>
            </div>

            <table class="main-table">
                <thead>
                    <tr>
                        <th>DESCRIPTION</th>
                        <th class="center-text">HOURS</th>
                        <th>RATE</th>
                        <th>AMOUNT</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>
                            ${data.contractorName || ''}
                            ${data.role ? ` - ${data.role}` : ''}
                            ${data.billingPeriod ? `<br/>(${data.billingPeriod})` : ''}
                        </td>
                        <td class="center-text">
                            ${data.hours || 0}
                        </td>
                        <td>
                            $${formattedRate}
                        </td>
                        <td>
                            $${formattedAmount}
                        </td>
                    </tr>
                </tbody>
            </table>

            <table class="total-table" style="margin-top: 20px;">
                <tr>
                    <td style="width: 50%;"></td>
                    <td class="total-label" style="width: 25%; text-align: right; padding-right: 15px;">TOTAL AMOUNT:</td>
                    <td class="total-amount" style="width: 25%; font-weight: normal;">$${formattedAmount}</td>
                </tr>
                <tr>
                    <td></td>
                    <td class="total-label" style="text-align: right; padding-right: 15px; color: #27ae60; border-top: none;">AMOUNT PAID:</td>
                    <td class="total-amount" style="color: #27ae60; font-weight: normal; border-top: none;">-$${formattedPaid}</td>
                </tr>
                <tr style="background-color: #fcfcfc;">
                    <td></td>
                    <td class="total-label" style="text-align: right; padding-right: 15px; font-weight: bold; border-top: 2px solid #000;">BALANCE DUE:</td>
                    <td class="total-amount" style="font-weight: bold; border-top: 2px solid #000; color: #c0392b;">$${formattedBalance}</td>
                </tr>
            </table>

            <div class="footer">
                <p>
                    Make all checks payable to:
                    <strong>GANDIVA INSIGHTS</strong> (Payable net ${netDays})
                </p>
                <p class="thanks-text">
                    Thank you for your business!
                </p>
            </div>
        </body>
        </html>
        `;
    } else {
        // ==========================================
        // 🎨 LEO DOES IT TEMPLATE
        // ==========================================
        htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <style>
                body {
                    font-family: Helvetica, Arial, sans-serif;
                    padding: 50px 40px;
                    color: #333;
                    font-size: 13px;
                    line-height: 1.5;
                }
                .header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 50px;
                }
                .company-name {
                    font-size: 18px;
                    font-weight: bold;
                    color: #000;
                }
                .invoice-title {
                    font-size: 40px;
                    color: #2874A6;
                    margin: 0;
                }
                .invoice-num {
                    font-size: 14px;
                    font-weight: bold;
                }
                .meta-section {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 40px;
                }
                .main-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 20px;
                }
                .main-table th {
                    background: #2874A6;
                    color: #fff;
                    padding: 12px;
                    text-align: left;
                }
                .main-table td {
                    padding: 12px;
                    border-bottom: 1px solid #ddd;
                }
                .right-col {
                    text-align: right;
                }
                .totals-container {
                    display: flex;
                    justify-content: flex-end;
                    margin-top: 20px;
                }
                .totals-table {
                    width: 300px;
                    border-collapse: collapse;
                }
                .totals-table td {
                    padding: 10px;
                    text-align: right;
                }
                .balance-row td {
                    background: #f4f6f6;
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div class="company-name">Leo Does IT Inc.</div>
                    <div>
                        1335 Regents Park Dr, Suite# 270.<br/>
                        Houston, Texas 77058.
                    </div>
                </div>
                <div>
                    <h1 class="invoice-title">Invoice</h1>
                    <div class="invoice-num">
                        # LDI-${data.invoiceNumber}
                    </div>
                </div>
            </div>

            <div class="meta-section">
                <div>
                    <strong>To</strong><br/>
                    ${data.clientName || ''}<br/>
                    ${
                        data.clientAddress
                            ? data.clientAddress.replace(/\n/g, '<br/>')
                            : ''
                    }
                </div>
                <div>
                    <table>
                        <tr>
                            <td>Invoice Date:</td>
                            <td>${invoiceDateStr}</td>
                        </tr>
                        <tr>
                            <td>Terms:</td>
                            <td>${netTermsStr}</td>
                        </tr>
                        <tr>
                            <td>Due Date:</td>
                            <td>${dueDateStr}</td>
                        </tr>
                    </table>
                </div>
            </div>

            <div style="margin-bottom:20px;">
                <strong>Client / End Client</strong><br/>
                ${data.clientName || ''}
                ${
                    data.vendorFor && data.vendorFor !== 'N/A'
                        ? '/ ' + data.vendorFor
                        : ''
                }
            </div>

            <table class="main-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Description</th>
                        <th class="right-col">Qty</th>
                        <th class="right-col">Rate</th>
                        <th class="right-col">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>1</td>
                        <td>
                            <strong>${data.contractorName || ''}</strong><br/>
                            ${data.role || ''}
                            <br/><br/>
                            Time Period: ${data.billingPeriod || ''}
                        </td>
                        <td class="right-col">
                            ${data.hours || 0}
                        </td>
                        <td class="right-col">
                            $${formattedRate}
                        </td>
                        <td class="right-col">
                            $${formattedAmount}
                        </td>
                    </tr>
                </tbody>
            </table>

            <div class="totals-container">
                <table class="totals-table">
                    <tr>
                        <td style="padding: 6px 10px;">Sub Total</td>
                        <td style="padding: 6px 10px;">$${formattedAmount}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 10px;"><strong>Total Invoice Amount</strong></td>
                        <td style="padding: 6px 10px;"><strong>$${formattedAmount}</strong></td>
                    </tr>
                    <tr style="color: #27ae60;">
                        <td style="padding: 6px 10px;">Amount Paid</td>
                        <td style="padding: 6px 10px;">-$${formattedPaid}</td>
                    </tr>
                    <tr class="balance-row" style="font-size: 14px;">
                        <td style="padding: 10px; color: #c0392b;">Balance Due</td>
                        <td style="padding: 10px; color: #c0392b;"><strong>$${formattedBalance}</strong></td>
                    </tr>
                </table>
            </div>

            <div style="margin-top:60px;">
                Thanks for your business.
            </div>
        </body>
        </html>
        `;
    }

    // ==========================================
    // ✅ Safe Serverless PDF Generation Block
    // ==========================================
    let browser = null;

    try {
        // Point to the hosted stable binary graphics layers
        const executablePath = await chromium.executablePath(
            `https://github.com/sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar`);
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless, // Let the package handle true/new seamlessly
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();

        await page.setContent(htmlContent, {
            waitUntil: 'networkidle0',
        });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', bottom: '20px' } // Helps keep text clear of physical page cuts
        });

        return pdfBuffer;

    } catch (error) {
        console.error('Error during PDF generation context:', error);
        throw error; 
    } finally {
        // Enforce browser closure under all conditions to prevent background memory leaks on Vercel
        if (browser !== null) {
            await browser.close();
        }
    }
};

module.exports = {
    generateInvoiceBuffer
};