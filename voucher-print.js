/* ==========================================================================
   Crown Head Spa — Shared printable voucher
   Used by the Daily Income Report (after generating) and the
   Voucher Masterlist (reprint). Opens a print-ready branded voucher;
   the browser's print dialog also allows "Save as PDF".
   ========================================================================== */

function printCrownVoucher(voucher){
    if(!voucher || !voucher.code){
        return;
    }

    function esc(value){
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    const tierLabel =
        voucher.tier ? ` (${voucher.tier})` : "";

    const issuedDate =
        voucher.issuedAt
            ? new Date(voucher.issuedAt).toLocaleDateString("en-PH", {
                  month: "long",
                  day: "numeric",
                  year: "numeric"
              })
            : "—";

    const printWindow =
        window.open("", "_blank", "width=800,height=600");

    if(!printWindow){
        alert("Please allow pop-ups for this site to print the voucher.");
        return;
    }

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Crown Head Spa — Gift Voucher ${esc(voucher.code)}</title>
<style>
  *{ margin:0; padding:0; box-sizing:border-box; }
  body{
    font-family:Georgia, "Times New Roman", serif;
    background:#F4F3EC;
    display:flex;
    align-items:center;
    justify-content:center;
    min-height:100vh;
    padding:24px;
  }
  .voucher{
    width:640px;
    background:#fff;
    border:2px solid #E8B321;
    border-radius:18px;
    overflow:hidden;
    box-shadow:0 10px 40px rgba(11,24,73,.18);
  }
  .voucher-head{
    background:linear-gradient(120deg,#0B1849,#16245C);
    color:#fff;
    text-align:center;
    padding:28px 24px 22px;
  }
  .voucher-head .brand{
    font-size:26px;
    font-weight:bold;
    color:#E8B321;
    letter-spacing:.04em;
  }
  .voucher-head .tagline{
    font-size:12px;
    letter-spacing:.28em;
    text-transform:uppercase;
    color:rgba(255,255,255,.75);
    margin-top:6px;
  }
  .voucher-body{
    padding:28px 36px;
    text-align:center;
  }
  .voucher-item{
    font-size:21px;
    color:#0B1849;
    font-weight:bold;
  }
  .voucher-value{
    font-size:15px;
    color:#6F746F;
    margin-top:4px;
  }
  .voucher-code{
    margin:22px auto;
    display:inline-block;
    padding:14px 30px;
    border:2px dashed #E8B321;
    border-radius:12px;
    background:#FFF4CF;
    font-family:"Courier New", monospace;
    font-size:28px;
    font-weight:bold;
    letter-spacing:.12em;
    color:#0B1849;
  }
  .voucher-meta{
    display:flex;
    justify-content:space-between;
    gap:16px;
    margin-top:10px;
    padding-top:18px;
    border-top:1px solid #E9E9E4;
    font-size:13px;
    color:#3d4147;
    text-align:left;
  }
  .voucher-meta strong{ display:block; color:#0B1849; font-size:14px; }
  .voucher-terms{
    background:#FAF9F4;
    padding:14px 36px 18px;
    font-size:10.5px;
    color:#91958F;
    text-align:center;
    line-height:1.6;
  }
  @media print{
    body{ background:#fff; padding:0; }
    .voucher{ box-shadow:none; }
  }
</style>
</head>
<body>
  <div class="voucher">
    <div class="voucher-head">
      <div class="brand">CROWN HEAD SPA</div>
      <div class="tagline">Gift Voucher</div>
    </div>

    <div class="voucher-body">
      <div class="voucher-item">${esc(voucher.name)}${esc(tierLabel)}</div>
      <div class="voucher-value">Voucher Value: &#8369;${(Number(voucher.value) || 0).toLocaleString("en-PH", {minimumFractionDigits:2})}</div>

      <div class="voucher-code">${esc(voucher.code)}</div>

      <div class="voucher-meta">
        <div>
          <span>Issued To</span>
          <strong>${esc(voucher.client || "—")}</strong>
        </div>
        <div>
          <span>Issued At</span>
          <strong>${esc(voucher.branch || "Crown Head Spa")}</strong>
        </div>
        <div>
          <span>Date Issued</span>
          <strong>${esc(issuedDate)}</strong>
        </div>
      </div>
    </div>

    <div class="voucher-terms">
      Present this voucher number upon availing. Valid for one-time use only
      and verified against the Crown Head Spa system. Non-transferable
      and not convertible to cash.
    </div>
  </div>
  <script>window.onload = function(){ window.print(); };<\/script>
</body>
</html>`);

    printWindow.document.close();
}
