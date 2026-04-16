"use client";

import type { Invoice } from "./invoiceService";
import type { Receipt } from "./receiptService";

export async function generateInvoicePDF(invoice: Invoice): Promise<Blob> {
  return printToPDF("invoice", renderInvoiceHTML(invoice));
}

export async function generateReceiptPDF(receipt: Receipt): Promise<Blob> {
  return printToPDF("receipt", renderReceiptHTML(receipt));
}

function renderInvoiceHTML(invoice: Invoice): string {
  const itemsHtml = invoice.lineItems
    .map(
      (item) => `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb">${item.description}</td>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb;text-align:center">${item.quantity}</td>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb;text-align:right">${item.unitPrice} ${invoice.asset}</td>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb;text-align:right">${(item.quantity * item.unitPrice).toFixed(2)} ${invoice.asset}</td>
      </tr>
    `
    )
    .join("");

  const logoHtml = invoice.from.logo
    ? `<img src="${invoice.from.logo}" style="height:48px;object-fit:contain" />`
    : `<div style="font-size:24px;font-weight:700;color:#10b981">${invoice.from.companyName}</div>`;

  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#111827;max-width:720px;margin:0 auto;padding:40px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px">
        <div>${logoHtml}</div>
        <div style="text-align:right">
          <div style="font-size:28px;font-weight:700">INVOICE</div>
          <div style="margin-top:8px;color:#6b7280">${invoice.invoiceNumber}</div>
          <div style="margin-top:4px;color:#6b7280">${formatDate(invoice.createdAt)}</div>
        </div>
      </div>

      <div style="display:flex;gap:40px;margin-bottom:40px">
        <div style="flex:1">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;font-weight:600;margin-bottom:8px">From</div>
          <div style="font-weight:600">${invoice.from.companyName}</div>
          ${invoice.from.email ? `<div style="color:#6b7280">${invoice.from.email}</div>` : ""}
          ${invoice.from.taxId ? `<div style="color:#6b7280">Tax ID: ${invoice.from.taxId}</div>` : ""}
          <div style="color:#6b7280;font-size:12px;word-break:break-all;margin-top:4px">${invoice.from.walletAddress}</div>
        </div>
        <div style="flex:1">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;font-weight:600;margin-bottom:8px">Bill To</div>
          <div style="font-weight:600">${invoice.to.name}</div>
          ${invoice.to.email ? `<div style="color:#6b7280">${invoice.to.email}</div>` : ""}
          ${invoice.to.walletAddress ? `<div style="color:#6b7280;font-size:12px;word-break:break-all;margin-top:4px">${invoice.to.walletAddress}</div>` : ""}
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:12px;text-align:left;font-weight:600">Description</th>
            <th style="padding:12px;text-align:center;font-weight:600">Qty</th>
            <th style="padding:12px;text-align:right;font-weight:600">Price</th>
            <th style="padding:12px;text-align:right;font-weight:600">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-bottom:40px">
        <div style="width:280px">
          <div style="display:flex;justify-content:space-between;padding:8px 0">
            <span style="color:#6b7280">Subtotal</span>
            <span style="font-weight:600">${invoice.subtotal.toFixed(2)} ${invoice.asset}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb">
            <span style="color:#6b7280">Tax (${invoice.taxRate ?? 0}%)</span>
            <span style="font-weight:600">${(invoice.tax ?? 0).toFixed(2)} ${invoice.asset}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:18px;font-weight:700">
            <span>Total</span>
            <span>${invoice.total.toFixed(2)} ${invoice.asset}</span>
          </div>
        </div>
      </div>

      <div style="border:1px dashed #d1d5db;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
        <div style="font-weight:600;margin-bottom:8px">Pay Privately</div>
        <div style="color:#6b7280;font-size:14px;margin-bottom:12px">Scan or visit the link to pay via The White Protocol</div>
        <div style="font-size:12px;color:#6b7280;word-break:break-all">${invoice.paymentLink}</div>
        <div style="margin-top:12px;font-size:12px;color:#6b7280">Network: ${invoice.chain === "base" ? "Base Sepolia" : "Solana Devnet"} | Asset: ${invoice.asset}</div>
      </div>

      <div style="text-align:center;color:#9ca3af;font-size:12px">
        Payment via The White Protocol — Private & Secure<br/>
        Powered by zero-knowledge proofs
      </div>
    </div>
  `;
}

function renderReceiptHTML(receipt: Receipt): string {
  const logoHtml = receipt.companyLogo
    ? `<img src="${receipt.companyLogo}" style="height:48px;object-fit:contain" />`
    : receipt.companyName
    ? `<div style="font-size:24px;font-weight:700;color:#10b981">${receipt.companyName}</div>`
    : "";

  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#111827;max-width:720px;margin:0 auto;padding:40px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px">
        <div>${logoHtml}</div>
        <div style="text-align:right">
          <div style="font-size:28px;font-weight:700">RECEIPT</div>
          <div style="margin-top:8px;color:#6b7280">${formatDate(receipt.createdAt)}</div>
        </div>
      </div>

      <div style="border-radius:12px;border:1px solid #e5e7eb;padding:24px;margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;margin-bottom:16px">
          <span style="color:#6b7280">Payment From</span>
          <span style="font-weight:500;word-break:break-all">${receipt.from.walletAddress}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:16px">
          <span style="color:#6b7280">Payment To</span>
          <span style="font-weight:500;word-break:break-all">${receipt.to.walletAddress}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:16px">
          <span style="color:#6b7280">Amount</span>
          <span style="font-weight:600">${receipt.amount.toFixed(4)} ${receipt.asset}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:16px">
          <span style="color:#6b7280">Network</span>
          <span style="font-weight:500">${receipt.chain}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:#6b7280">Transaction</span>
          <span style="font-weight:500;word-break:break-all;font-size:12px">${receipt.txHash}</span>
        </div>
      </div>

      <div style="text-align:center;margin-bottom:24px">
        <div style="display:inline-flex;align-items:center;gap:8px;background:#d1fae5;color:#065f46;padding:8px 16px;border-radius:9999px;font-weight:600">
          <span>✓</span> PAID
        </div>
      </div>

      <div style="text-align:center;color:#9ca3af;font-size:12px">
        This payment was processed privately via The White Protocol using zero-knowledge proofs.
      </div>
    </div>
  `;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function printToPDF(filenamePrefix: string, html: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.top = "-9999px";
    iframe.style.left = "-9999px";
    iframe.style.width = "0";
    iframe.style.height = "0";
    document.body.appendChild(iframe);

    iframe.onload = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return reject(new Error("Failed to access iframe document"));
        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8" />
              <title>${filenamePrefix}</title>
              <style>
                @media print {
                  body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
              </style>
            </head>
            <body>${html}</body>
          </html>
        `);
        doc.close();

        setTimeout(() => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          // We can't easily get a Blob from window.print(), so we resolve with a placeholder
          // In practice, the browser's print dialog lets the user save as PDF
          resolve(new Blob([html], { type: "text/html" }));
          setTimeout(() => document.body.removeChild(iframe), 1000);
        }, 500);
      } catch (err) {
        reject(err);
      }
    };

    // Trigger load
    iframe.src = "about:blank";
  });
}
