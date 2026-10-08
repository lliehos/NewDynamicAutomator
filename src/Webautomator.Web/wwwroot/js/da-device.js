(function () {
  function fnv(raw) {
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0") + raw.length.toString(16);
  }

  function collect() {
    const nav = navigator || {};
    const screenStr = (typeof screen !== "undefined")
      ? `${screen.width}x${screen.height}x${screen.colorDepth}`
      : "";
    const tz = (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; }
      catch { return ""; }
    })();

    // Machine-stable (no userAgent) so Chrome/Edge on one PC share one guest identity.
    const machineParts = [
      nav.platform || "",
      tz,
      screenStr,
      String(nav.hardwareConcurrency || ""),
      String(nav.deviceMemory || ""),
      String(nav.maxTouchPoints || 0)
    ];
    const machineRaw = machineParts.join("|");

    // Browser-specific audit fingerprint (includes UA).
    const browserParts = [
      nav.userAgent || "",
      ...machineParts,
      nav.language || ""
    ];
    const browserRaw = browserParts.join("|");

    let machineHash = "na";
    let browserHash = "na";
    try {
      machineHash = fnv(machineRaw);
      browserHash = fnv(browserRaw);
    } catch { /* ignore */ }

    return {
      fingerprintHash: machineHash,
      machineFingerprint: machineHash,
      browserFingerprint: browserHash,
      userAgent: nav.userAgent || "",
      platform: nav.platform || "",
      language: nav.language || "",
      timeZone: tz,
      screen: screenStr,
      hardwareConcurrency: nav.hardwareConcurrency || null,
      detailsJson: JSON.stringify({
        vendor: nav.vendor || "",
        maxTouchPoints: nav.maxTouchPoints || 0,
        deviceMemory: nav.deviceMemory || null,
        cookieEnabled: nav.cookieEnabled,
        machineFingerprint: machineHash,
        browserFingerprint: browserHash
      })
    };
  }

  window.DaDevice = { collect };
})();
