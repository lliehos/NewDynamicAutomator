/**
 * Offline update page: drop-zone behaviour and state feedback for the upload form.
 *
 * The markup works without this file (the file input is still reachable and the form still
 * posts), so everything here is progressive enhancement: drag and drop, a filename preview,
 * a client-side size/type guard, and a busy state that stops a double submit.
 */
(function () {
  "use strict";

  var form = document.getElementById("offline-upload-form");
  if (!form) return;

  var input = document.getElementById("package");
  var zone = document.getElementById("offline-dropzone");
  var note = document.getElementById("offline-file-note");
  var clientError = document.getElementById("offline-client-error");
  var submit = document.getElementById("offline-upload-submit");
  var clear = document.getElementById("offline-upload-clear");
  var progress = document.getElementById("offline-upload-progress");
  var maxMb = parseInt(form.getAttribute("data-max-mb") || "0", 10);

  var MSG = {
    tooLarge: form.getAttribute("data-msg-too-large") || "",
    wrongType: form.getAttribute("data-msg-wrong-type") || "",
    ok: form.getAttribute("data-msg-ready") || ""
  };

  function show(el, message) {
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.classList.remove("is-hidden");
    } else {
      el.textContent = "";
      el.classList.add("is-hidden");
    }
  }

  /** A zip by extension or MIME type. Browsers are inconsistent about reporting the type. */
  function looksLikeZip(file) {
    if (!file) return false;
    if (/\.zip$/i.test(file.name)) return true;
    return file.type === "application/zip" || file.type === "application/x-zip-compressed";
  }

  function humanSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
    return bytes + " B";
  }

  /** Re-evaluate the chosen file and reflect it in the zone, the note and the submit button. */
  function refresh() {
    var file = input.files && input.files[0];
    show(clientError, "");

    if (!file) {
      zone.classList.remove("has-file", "is-invalid");
      show(note, "");
      submit.disabled = true;
      if (clear) clear.classList.add("is-hidden");
      return;
    }

    if (!looksLikeZip(file)) {
      zone.classList.add("is-invalid");
      zone.classList.remove("has-file");
      show(note, "");
      show(clientError, MSG.wrongType);
      submit.disabled = true;
      if (clear) clear.classList.remove("is-hidden");
      return;
    }

    if (maxMb > 0 && file.size > maxMb * 1024 * 1024) {
      zone.classList.add("is-invalid");
      zone.classList.remove("has-file");
      show(note, "");
      show(clientError, MSG.tooLarge.replace("{size}", humanSize(file.size)).replace("{max}", String(maxMb)));
      submit.disabled = true;
      if (clear) clear.classList.remove("is-hidden");
      return;
    }

    zone.classList.remove("is-invalid");
    zone.classList.add("has-file");
    show(note, MSG.ok.replace("{name}", file.name).replace("{size}", humanSize(file.size)));
    submit.disabled = false;
    if (clear) clear.classList.remove("is-hidden");
  }

  input.addEventListener("change", refresh);

  if (clear) {
    clear.addEventListener("click", function () {
      input.value = "";
      refresh();
      input.focus();
    });
  }

  // Drag and drop. dragenter/dragleave fire for child elements too, so the counter keeps the
  // highlight stable while the pointer moves across the zone.
  var depth = 0;

  ["dragenter", "dragover"].forEach(function (name) {
    zone.addEventListener(name, function (ev) {
      ev.preventDefault();
      if (name === "dragenter") depth++;
      zone.classList.add("is-drop");
    });
  });

  zone.addEventListener("dragleave", function (ev) {
    ev.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) zone.classList.remove("is-drop");
  });

  zone.addEventListener("drop", function (ev) {
    ev.preventDefault();
    depth = 0;
    zone.classList.remove("is-drop");
    var files = ev.dataTransfer && ev.dataTransfer.files;
    if (!files || !files.length) return;
    // A DataTransfer is the only way to set input.files; wrap in one so the rest of the
    // handler behaves exactly as if the file had been picked from the dialog.
    try {
      var dt = new DataTransfer();
      dt.items.add(files[0]);
      input.files = dt.files;
    } catch (e) {
      // Older browsers: fall through and let the change handler read what it can.
      show(clientError, MSG.wrongType);
    }
    refresh();
  });

  form.addEventListener("submit", function (ev) {
    if (submit.disabled) {
      ev.preventDefault();
      return;
    }
    // The upload can be large and the server stages it before answering, so lock the controls
    // to make a second click impossible.
    submit.disabled = true;
    if (clear) clear.classList.add("is-hidden");
    if (progress) progress.classList.remove("is-hidden");
  });

  // The apply button only unlocks once the operator has confirmed the app is stopped.
  var stopFirst = document.getElementById("offline-stop-first");
  var applySubmit = document.getElementById("offline-apply-submit");
  if (stopFirst && applySubmit) {
    stopFirst.addEventListener("change", function () {
      applySubmit.disabled = !stopFirst.checked;
    });
  }

  refresh();
})();
