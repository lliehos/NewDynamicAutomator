/*
 * Local QR shim — exposes the small slice of the `qrcode` npm API that the portal actually uses.
 *
 * Why this exists: the referral widget originally pulled `qrcode@1.5.4/build/qrcode.min.js` from
 * jsDelivr. That URL does not exist (the npm package ships no browser bundle), so the script 404'd
 * on every page — and the deployment is not allowed to reach an external CDN anyway.
 *
 * Rather than change the call site, this adapts the vendored `qrcode-generator` encoder
 * (wwwroot/lib/qrcode/qrcode-generator.min.js, a real QR implementation) to the exact signature
 * `referral-qr.js` already calls:
 *
 *     QRCode.toCanvas(canvas, text, { width, margin, color: { dark, light } }, callback)
 *
 * Everything is in-page and offline. If the encoder is somehow missing the shim stays absent and
 * the caller's own fallback path runs, so a failure here degrades instead of throwing.
 */
(function () {
  "use strict";

  // `qrcode-generator` publishes itself as a global factory function named `qrcode`.
  if (typeof window.qrcode !== "function") return;

  function draw(canvas, text, opts, cb) {
    opts = opts || {};
    var width = opts.width || canvas.width || 200;
    var margin = opts.margin == null ? 1 : opts.margin;
    var dark = (opts.color && opts.color.dark) || "#000000";
    var light = (opts.color && opts.color.light) || "#ffffff";

    // Error-correction "M" is the conventional middle ground and what the npm default used.
    var qr = window.qrcode(0, "M");
    qr.addData(String(text));
    qr.make();

    // Total modules include the quiet-zone margin on all four sides.
    var count = qr.getModuleCount() + margin * 2;
    // Integer scale keeps modules crisp; the canvas is then sized exactly to the module grid.
    var scale = Math.max(1, Math.floor(width / count));
    var px = count * scale;

    canvas.width = px;
    canvas.height = px;
    // Preserve the caller's CSS size so layout does not jump when the canvas resizes.
    canvas.style.width = width + "px";
    canvas.style.height = width + "px";

    var ctx = canvas.getContext("2d");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = dark;

    for (var r = 0; r < qr.getModuleCount(); r++) {
      for (var c = 0; c < qr.getModuleCount(); c++) {
        if (!qr.isDark(r, c)) continue;
        ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
      }
    }

    if (typeof cb === "function") cb(null);
  }

  window.QRCode = window.QRCode || {};
  window.QRCode.toCanvas = draw;

  // The same grid as a data URL / DOM node, for any future caller that wants them.
  window.QRCode.toDataURL = function (text, opts, cb) {
    var canvas = document.createElement("canvas");
    draw(canvas, text, opts, function (err) {
      if (typeof cb === "function") cb(err, err ? null : canvas.toDataURL("image/png"));
    });
  };
})();
