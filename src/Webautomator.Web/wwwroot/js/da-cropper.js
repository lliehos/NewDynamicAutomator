/*
 * da-cropper.js — dependency-free image cropper used by every image upload.
 *
 * Why a hand-written cropper: the project ships no cropping library and adding a
 * vendor bundle for two upload fields was not worth it. This uses a single
 * <canvas>, so it needs no CSS transforms or third-party runtime, and it can
 * re-encode the result (PNG for transparency, JPEG otherwise) to keep the
 * upload small.
 *
 * Usage:
 *   DaCropper.open({
 *     file,                 // File from an <input type=file>
 *     aspect,               // width/height, null/0 = free
 *     maxWidth, maxHeight,  // optional output clamp (SVG is passed through)
 *     title,                // localized dialog title
 *     strings: { zoom, rotate, reset, cancel, apply, free },
 *     onApply: (blob, meta) => { ... }   // meta = { width, height, type, name }
 *   });
 *
 * Vectors (SVG) are deliberately NOT rasterised — cropping them would trade a
 * crisp scalable asset for a fixed-size bitmap — so `onApply` receives the
 * original File untouched with `meta.passthrough = true`.
 */
(function () {
  "use strict";

  var MAX_ZOOM = 8;
  var MIN_SCALE_FLOOR = 0.05;

  function isVector(file) {
    return /svg/i.test(file.type || "") || /\.svg$/i.test(file.name || "");
  }

  var DEFAULT_STRINGS = {
    zoom: "Zoom",
    rotate: "Rotate",
    reset: "Reset",
    cancel: "Cancel",
    apply: "Apply",
    free: "Free"
  };

  function Cropper(opts) {
    this.opts = opts || {};
    this.strings = Object.assign({}, DEFAULT_STRINGS, this.opts.strings || {});
    this.aspect = this.opts.aspect || null;
    this.zoom = 1;
    this.rotation = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.img = null;
    this.dragging = null;
    this.ready = false;
  }

  /** Frame aspect in CSS px, honouring the requested aspect (null = free). */
  Cropper.prototype.frameAspect = function () {
    return this.aspect || (this.canvas.width / this.canvas.height) || 1;
  };

  /** Scale at which the image exactly covers the frame (the minimum useful zoom). */
  Cropper.prototype.coverScale = function () {
    var w = this.img.naturalWidth;
    var h = this.img.naturalHeight;
    // Rotation by 90/270 swaps the effective footprint.
    if (Math.abs(this.rotation % 180) === 90) { var t = w; w = h; h = t; }
    return Math.max(this.canvas.width / w, this.canvas.height / h);
  };

  Cropper.prototype.effectiveScale = function () {
    return this.coverScale() * this.zoom;
  };

  Cropper.prototype.clampOffsets = function () {
    var s = this.effectiveScale();
    var w = this.img.naturalWidth * s;
    var h = this.img.naturalHeight * s;
    if (Math.abs(this.rotation % 180) === 90) { var t = w; w = h; h = t; }
    var maxX = Math.max(0, (w - this.canvas.width) / 2);
    var maxY = Math.max(0, (h - this.canvas.height) / 2);
    this.offsetX = Math.min(maxX, Math.max(-maxX, this.offsetX));
    this.offsetY = Math.min(maxY, Math.max(-maxY, this.offsetY));
  };

  Cropper.prototype.draw = function () {
    if (!this.ready) return;
    this.clampOffsets();
    var ctx = this.ctx;
    var cw = this.canvas.width;
    var ch = this.canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, cw, ch);
    // Checkerboard so transparent PNGs are readable.
    ctx.fillStyle = "#f1f3f5";
    ctx.fillRect(0, 0, cw, ch);
    ctx.translate(cw / 2 + this.offsetX, ch / 2 + this.offsetY);
    ctx.rotate((this.rotation * Math.PI) / 180);
    var s = this.effectiveScale();
    var w = this.img.naturalWidth * s;
    var h = this.img.naturalHeight * s;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  };

  /** Build the crop result at the source resolution (no upscaling). */
  Cropper.prototype.toBlob = function () {
    var s = this.effectiveScale();
    var srcW = this.canvas.width / s;
    var srcH = this.canvas.height / s;

    var out = document.createElement("canvas");
    var oW = Math.max(1, Math.round(srcW));
    var oH = Math.max(1, Math.round(srcH));
    var clampW = Number(this.opts.maxWidth) || 0;
    var clampH = Number(this.opts.maxHeight) || 0;
    if (clampW > 0 && oW > clampW) { oH = Math.round(oH * (clampW / oW)); oW = clampW; }
    if (clampH > 0 && oH > clampH) { oW = Math.round(oW * (clampH / oH)); oH = clampH; }
    out.width = oW;
    out.height = oH;

    // Reproduce the preview transform at output resolution: the preview canvas
    // and the output canvas share the same frame aspect, so a single scale
    // factor `k` maps preview pixels to output pixels.
    var k = oW / this.canvas.width;
    var octx = out.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.save();
    octx.translate(oW / 2 + this.offsetX * k, oH / 2 + this.offsetY * k);
    octx.rotate((this.rotation * Math.PI) / 180);
    var sw = this.img.naturalWidth * s * k;
    var sh = this.img.naturalHeight * s * k;
    octx.drawImage(this.img, -sw / 2, -sh / 2, sw, sh);
    octx.restore();

    var type = /png|webp/i.test(this.opts.file.type || "") ? "image/png" : "image/jpeg";
    return new Promise(function (resolve) {
      out.toBlob(function (b) { resolve({ blob: b, width: oW, height: oH, type: type }); }, type, 0.92);
    });
  };

  /** Mount the dialog and wire all interactions. */
  Cropper.prototype.open = function () {
    var self = this;
    var s = this.strings;
    this.backdrop = document.createElement("div");
    this.backdrop.className = "da-crop-backdrop";
    this.backdrop.innerHTML =
      '<div class="da-crop-box" role="dialog" aria-modal="true" aria-label="' + esc(this.opts.title || "") + '">' +
        '<h3 class="da-crop-title">' + esc(this.opts.title || "") + "</h3>" +
        '<div class="da-crop-stage"><canvas class="da-crop-canvas"></canvas>' +
          '<div class="da-crop-grid" aria-hidden="true"></div></div>' +
        '<div class="da-crop-controls">' +
          '<label class="da-crop-ctl"><span>' + esc(s.zoom) + '</span>' +
            '<input type="range" class="da-crop-zoom" min="100" max="' + (MAX_ZOOM * 100) + '" value="100" /></label>' +
          '<label class="da-crop-ctl"><span>' + esc(s.rotate) + '</span>' +
            '<input type="range" class="da-crop-rotate" min="-180" max="180" step="1" value="0" /></label>' +
          '<button type="button" class="da-crop-btn ghost da-crop-reset">' + esc(s.reset) + "</button>" +
        "</div>" +
        '<div class="da-crop-actions">' +
          '<span class="da-crop-aspect">' + (this.aspect ? fmtAspect(this.aspect) : esc(s.free)) + "</span>" +
          '<button type="button" class="da-crop-btn ghost da-crop-cancel">' + esc(s.cancel) + "</button>" +
          '<button type="button" class="da-crop-btn primary da-crop-apply">' + esc(s.apply) + "</button>" +
        "</div>" +
      "</div>";
    document.documentElement.appendChild(this.backdrop);

    this.canvas = this.backdrop.querySelector(".da-crop-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.img = new Image();

    var close = function () { self.destroy(); };

    this.img.onload = function () {
      // Size the canvas to the frame at device pixel ratio for a crisp preview.
      var dpr = window.devicePixelRatio || 1;
      var maxW = Math.min(560, window.innerWidth - 80);
      var maxH = Math.min(420, window.innerHeight - 240);
      var fa = self.aspect || (self.img.naturalWidth / self.img.naturalHeight);
      var w = maxW;
      var h = Math.round(w / fa);
      if (h > maxH) { h = maxH; w = Math.round(h * fa); }
      self.canvas.width = Math.round(w * dpr);
      self.canvas.height = Math.round(h * dpr);
      self.canvas.style.width = w + "px";
      self.canvas.style.height = h + "px";
      self.ready = true;
      self.zoom = 1;
      self.offsetX = 0;
      self.offsetY = 0;
      // Align the thirds guides with the canvas rect inside the padded stage.
      var gridEl = self.backdrop.querySelector(".da-crop-grid");
      if (gridEl) {
        var stage = self.canvas.parentNode;
        var cr = self.canvas.getBoundingClientRect();
        var sr = stage.getBoundingClientRect();
        gridEl.style.left = (cr.left - sr.left) + "px";
        gridEl.style.top = (cr.top - sr.top) + "px";
        gridEl.style.width = cr.width + "px";
        gridEl.style.height = cr.height + "px";
      }
      self.draw();
    };
    var url = URL.createObjectURL(this.opts.file);
    this._objectUrl = url;
    this.img.onerror = function () { close(); };
    this.img.src = url;

    // ---- drag to pan ----
    var start = null;
    this.canvas.addEventListener("pointerdown", function (ev) {
      if (!self.ready) return;
      start = { x: ev.clientX, y: ev.clientY, ox: self.offsetX, oy: self.offsetY };
      self.canvas.setPointerCapture(ev.pointerId);
      self.canvas.classList.add("is-dragging");
    });
    this.canvas.addEventListener("pointermove", function (ev) {
      if (!start) return;
      self.offsetX = start.ox + (ev.clientX - start.x);
      self.offsetY = start.oy + (ev.clientY - start.y);
      self.draw();
    });
    var endDrag = function (ev) {
      if (!start) return;
      start = null;
      self.canvas.classList.remove("is-dragging");
      try { self.canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);

    // ---- wheel zoom ----
    this.canvas.addEventListener("wheel", function (ev) {
      if (!self.ready) return;
      ev.preventDefault();
      self.setZoom(self.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
      self.backdrop.querySelector(".da-crop-zoom").value = String(Math.round(self.zoom * 100));
    }, { passive: false });

    // ---- controls ----
    var zoomEl = this.backdrop.querySelector(".da-crop-zoom");
    zoomEl.addEventListener("input", function () { self.setZoom(Number(zoomEl.value) / 100); });
    var rotEl = this.backdrop.querySelector(".da-crop-rotate");
    rotEl.addEventListener("input", function () { self.setRotation(Number(rotEl.value)); });
    this.backdrop.querySelector(".da-crop-reset").addEventListener("click", function () {
      self.zoom = 1; self.rotation = 0; self.offsetX = 0; self.offsetY = 0;
      zoomEl.value = "100"; rotEl.value = "0";
      self.draw();
    });
    this.backdrop.querySelector(".da-crop-cancel").addEventListener("click", close);
    this.backdrop.addEventListener("click", function (ev) {
      if (ev.target === self.backdrop) close();
    });
    this.backdrop.querySelector(".da-crop-apply").addEventListener("click", function () {
      var btn = self.backdrop.querySelector(".da-crop-apply");
      btn.disabled = true;
      self.toBlob().then(function (res) {
        if (self.opts.onApply) {
          self.opts.onApply(res.blob, { width: res.width, height: res.height, type: res.type, name: outputName(self.opts.file.name, res.type) });
        }
        close();
      });
    });

    var onKey = function (ev) {
      if (ev.key === "Escape") { ev.preventDefault(); close(); }
    };
    document.addEventListener("keydown", onKey, true);
    this._onKey = onKey;
  };

  Cropper.prototype.setZoom = function (z) {
    var min = MIN_SCALE_FLOOR;
    this.zoom = Math.min(MAX_ZOOM, Math.max(min, Number(z) || 1));
    // Never allow the image to be smaller than the frame.
    if (this.zoom < 1) this.zoom = 1;
    this.draw();
  };

  Cropper.prototype.setRotation = function (deg) {
    this.rotation = Math.max(-180, Math.min(180, Number(deg) || 0));
    this.draw();
  };

  Cropper.prototype.destroy = function () {
    if (this._objectUrl) { try { URL.revokeObjectURL(this._objectUrl); } catch (e) { /* ignore */ } }
    if (this._onKey) document.removeEventListener("keydown", this._onKey, true);
    if (this.backdrop && this.backdrop.parentNode) this.backdrop.parentNode.removeChild(this.backdrop);
    this.backdrop = null;
    this.ready = false;
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtAspect(a) {
    if (Math.abs(a - 1) < 0.001) return "1:1";
    var known = { 1.7778: "16:9", 1.3333: "4:3", 1.5: "3:2", 0.5625: "9:16", 0.75: "3:4", 0.6667: "2:3" };
    for (var k in known) { if (Math.abs(a - Number(k)) < 0.02) return known[k]; }
    return a.toFixed(2) + ":1";
  }

  function outputName(name, type) {
    var base = String(name || "image").replace(/\.[^.]+$/, "");
    var ext = type === "image/png" ? "png" : "jpg";
    return base + "-cropped." + ext;
  }

  var DaCropper = {
    /** Open the cropper for `opts.file`. Vector files bypass cropping. */
    open: function (opts) {
      if (!opts || !opts.file) return;
      if (isVector(opts.file)) {
        if (opts.onApply) opts.onApply(opts.file, { passthrough: true, name: opts.file.name, type: opts.file.type });
        return;
      }
      new Cropper(opts).open();
    },
    isVector: isVector
  };

  window.DaCropper = DaCropper;
})();
