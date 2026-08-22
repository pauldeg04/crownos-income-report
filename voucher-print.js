/* ==========================================================================
   Crown Head Spa — Shared printable voucher (jsPDF, vector-drawn)
   Used by the Daily Income Report (after a sale settles) and the
   Voucher Masterlist (reprint / download). Renders the branded dark-blue
   voucher card straight into a real PDF with jsPDF's drawing API — no
   html2canvas rasterization, so the output never gets blurry no matter
   how many vouchers are packed onto the A4 page.
   ========================================================================== */

const CROWN_VOUCHER_PDF = {
    pageWidth: 210,
    pageHeight: 297,
    margin: 14,
    cardHeight: 82,
    cardGap: 8,

    colors: {
        navyDark: [11, 24, 73],      /* #0B1849 */
        navyLight: [22, 36, 92],     /* #16245C */
        gold: [232, 179, 33],        /* #E8B321 */
        cream: [255, 244, 207],      /* #FFF4CF */
        white: [255, 255, 255],
        softWhite: [214, 220, 240],
        red: [179, 38, 30]           /* #B3261E */
    }
};

/* Registers the Cinzel Decorative typeface (loaded from
   voucher-font-cinzel.js, which must be included before this file) for
   the "CROWN HEAD SPA" wordmark. jsPDF de-dupes addFont calls by VFS
   filename, so calling this once per document build is enough. */
function registerCrownVoucherFonts(doc){
    if(typeof CROWN_VOUCHER_FONT_CINZEL_BOLD === "undefined"){
        return false;
    }

    doc.addFileToVFS("CinzelDecorative-Bold.ttf", CROWN_VOUCHER_FONT_CINZEL_BOLD);
    doc.addFont("CinzelDecorative-Bold.ttf", "CinzelDecorative", "bold");

    return true;
}

/* jsPDF's built-in helvetica has no peso glyph — it prints as a
   replacement character. Use "PHP" for anything drawn on the PDF. */
function crownVoucherPesoPdf(amount){
    return "PHP " + (Number(amount) || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function crownVoucherDateLabel(isoValue){
    if(!isoValue){
        return "—";
    }

    return new Date(isoValue).toLocaleDateString("en-PH", {
        month: "long",
        day: "numeric",
        year: "numeric"
    });
}

/* Purchase vouchers are valid for 6 months from the date they became
   official (i.e. from finalizeSaleVouchers() in script.js, when the
   sale carrying them is Settled) — shared by the redemption check in
   script.js, the Masterlist's Expired badge, and this PDF. */
const CROWN_VOUCHER_VALIDITY_MONTHS = 6;

function crownVoucherExpiresAt(issuedAtIso){
    if(!issuedAtIso){
        return "";
    }

    const issued = new Date(issuedAtIso);

    if(isNaN(issued.getTime())){
        return "";
    }

    issued.setMonth(issued.getMonth() + CROWN_VOUCHER_VALIDITY_MONTHS);

    return issued.toISOString();
}

function isCrownVoucherExpired(voucher){
    if(!voucher || !voucher.expiresAt){
        return false;
    }

    return new Date(voucher.expiresAt).getTime() < Date.now();
}

function crownVoucherStatusStamp(voucher){
    if(voucher.status === "redeemed"){
        return {
            label: "REDEEMED",
            detail: voucher.redeemedAt
                ? "on " + crownVoucherDateLabel(voucher.redeemedAt)
                : ""
        };
    }

    if(voucher.status === "cancelled"){
        return { label: "CANCELLED", detail: "" };
    }

    if(isCrownVoucherExpired(voucher)){
        return {
            label: "EXPIRED",
            detail: "on " + crownVoucherDateLabel(voucher.expiresAt)
        };
    }

    return null;
}

/* Draws one voucher card with its top-left corner at (x, y). */
function drawCrownVoucherCard(doc, voucher, x, y, hasWordmarkFont){
    const C = CROWN_VOUCHER_PDF;
    const width = C.pageWidth - C.margin * 2;
    const height = C.cardHeight;

    const tierLabel = voucher.tier ? ` (${voucher.tier})` : "";

    /* Card background + gold border. */
    doc.setFillColor(...C.colors.navyDark);
    doc.setDrawColor(...C.colors.gold);
    doc.setLineWidth(0.6);
    doc.roundedRect(x, y, width, height, 3, 3, "FD");

    /* Subtle header band for depth (no true gradients in jsPDF). */
    doc.setFillColor(...C.colors.navyLight);
    doc.roundedRect(x, y, width, 20, 3, 3, "F");
    doc.rect(x, y + 12, width, 8, "F");

    doc.setTextColor(...C.colors.gold);

    if(hasWordmarkFont){
        doc.setFont("CinzelDecorative", "bold");
        doc.setFontSize(13);
        doc.text("CROWN HEAD SPA", x + width / 2, y + 9.5, { align: "center" });
    }else{
        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.text("CROWN HEAD SPA", x + width / 2, y + 9, { align: "center" });
    }

    doc.setTextColor(...C.colors.softWhite);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("G I F T   V O U C H E R", x + width / 2, y + 15.5, { align: "center" });

    /* Item + value. */
    doc.setTextColor(...C.colors.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.text(
        `${voucher.name || ""}${tierLabel}`,
        x + width / 2,
        y + 29,
        { align: "center" }
    );

    doc.setTextColor(...C.colors.softWhite);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
        `Voucher Value: ${crownVoucherPesoPdf(voucher.value)}`,
        x + width / 2,
        y + 35,
        { align: "center" }
    );

    /* Voucher code box. */
    const codeBoxWidth = 78;
    const codeBoxX = x + (width - codeBoxWidth) / 2;
    const codeBoxY = y + 39;
    const codeBoxHeight = 13;

    doc.setFillColor(...C.colors.cream);
    doc.setDrawColor(...C.colors.gold);
    doc.setLineWidth(0.7);
    doc.roundedRect(codeBoxX, codeBoxY, codeBoxWidth, codeBoxHeight, 2, 2, "FD");

    /* Thin inner hairline for a framed, premium look instead of a
       dashed border. */
    doc.setLineWidth(0.25);
    doc.roundedRect(
        codeBoxX + 1.3,
        codeBoxY + 1.3,
        codeBoxWidth - 2.6,
        codeBoxHeight - 2.6,
        1.4,
        1.4,
        "D"
    );

    doc.setTextColor(...C.colors.navyDark);
    doc.setFont("courier", "bold");
    doc.setFontSize(14);
    doc.text(
        String(voucher.code || ""),
        x + width / 2,
        codeBoxY + codeBoxHeight / 2 + 1.6,
        { align: "center" }
    );

    /* Meta row: Issued To / Branch / Date Issued / Valid Until. */
    const metaY = y + 60;
    doc.setDrawColor(...C.colors.navyLight);
    doc.setLineWidth(0.3);
    doc.line(x + 8, metaY - 4, x + width - 8, metaY - 4);

    const metaCols = [
        { label: "Issued To", value: voucher.client || "—" },
        { label: "Branch", value: voucher.branch || "Crown Head Spa" },
        { label: "Date Issued", value: crownVoucherDateLabel(voucher.issuedAt) },
        { label: "Valid Until", value: crownVoucherDateLabel(voucher.expiresAt) }
    ];

    const metaColWidth = (width - 16) / 4;

    metaCols.forEach(function(col, index){
        const colX = x + 8 + metaColWidth * index;

        doc.setTextColor(...C.colors.softWhite);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(col.label, colX, metaY);

        doc.setTextColor(...C.colors.white);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.text(
            String(col.value).slice(0, 20),
            colX,
            metaY + 4.5
        );
    });

    /* Terms footer. */
    doc.setTextColor(...C.colors.softWhite);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.3);
    doc.text(
        "Present this voucher number upon availing. Valid for one-time use only and verified against the Crown Head Spa system.",
        x + width / 2,
        y + height - 8,
        { align: "center" }
    );
    doc.text(
        "Non-transferable and not convertible to cash.",
        x + width / 2,
        y + height - 4.8,
        { align: "center" }
    );

    /* Status stamp, if reprinting a redeemed/cancelled voucher. */
    const stamp = crownVoucherStatusStamp(voucher);

    if(stamp){
        doc.saveGraphicsState();
        doc.setTextColor(...C.colors.red);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);

        const centerX = x + width / 2;
        const centerY = y + height / 2;

        doc.text(stamp.label, centerX, centerY, {
            align: "center",
            angle: 12
        });

        if(stamp.detail){
            doc.setFontSize(8);
            doc.text(stamp.detail, centerX, centerY + 6, {
                align: "center",
                angle: 12
            });
        }

        doc.restoreGraphicsState();
    }
}

/* Builds a jsPDF document with one card per voucher, stacked on A4 pages —
   as many as fit per page, continuing onto new pages as needed. */
function buildCrownVoucherPdf(vouchers){
    if(!window.jspdf || !window.jspdf.jsPDF){
        alert("PDF library failed to load. Please refresh the page and try again.");
        return null;
    }

    const list = (Array.isArray(vouchers) ? vouchers : [vouchers]).filter(Boolean);

    if(list.length === 0){
        return null;
    }

    const C = CROWN_VOUCHER_PDF;
    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
    });

    const hasWordmarkFont = registerCrownVoucherFonts(doc);

    const usableHeight = C.pageHeight - C.margin * 2;
    const perPage = Math.max(
        1,
        Math.floor((usableHeight + C.cardGap) / (C.cardHeight + C.cardGap))
    );

    list.forEach(function(voucher, index){
        const posOnPage = index % perPage;

        if(index > 0 && posOnPage === 0){
            doc.addPage();
        }

        const y = C.margin + posOnPage * (C.cardHeight + C.cardGap);

        drawCrownVoucherCard(doc, voucher, C.margin, y, hasWordmarkFont);
    });

    return doc;
}

function crownVoucherPdfFilename(vouchers){
    const list = (Array.isArray(vouchers) ? vouchers : [vouchers]).filter(Boolean);

    if(list.length === 1){
        return `Crown-Voucher-${list[0].code || "voucher"}.pdf`;
    }

    return `Crown-Vouchers-${list.length}-${new Date().toISOString().slice(0, 10)}.pdf`;
}

/* Builds the PDF and downloads it immediately — no browser print dialog. */
function downloadCrownVoucherPdf(vouchers, filename){
    const doc = buildCrownVoucherPdf(vouchers);

    if(!doc){
        return;
    }

    doc.save(filename || crownVoucherPdfFilename(vouchers));
}

/* Kept for the Voucher Masterlist's reprint button — same instant
   download behavior, single voucher. */
function printCrownVoucher(voucher){
    if(!voucher || !voucher.code){
        return;
    }

    downloadCrownVoucherPdf([voucher]);
}
