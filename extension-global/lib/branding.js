/** Tenant branding from morobot-branding.json, portal page, or chrome.storage. */
const DaTenantBranding = (() => {
  const STORAGE_KEY = "tenantBranding";
  let cached = null;

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const appName = String(raw.appName || raw.AppName || "").trim();
    if (!appName) return null;
    return {
      appName,
      brandTitle: String(raw.brandTitle || raw.BrandTitle || appName).trim(),
      organizationName: raw.organizationName || raw.OrganizationName || null,
      logoUrl: raw.logoUrl || raw.LogoUrl || null,
      faviconUrl: raw.faviconUrl || raw.FaviconUrl || null,
      extensionName: String(raw.extensionName || raw.ExtensionName || `${appName} Global`).trim(),
      actionTitle: String(raw.actionTitle || raw.ActionTitle || `${appName} — ${raw.brandTitle || appName}`).trim(),
      isLicensedBranding: !!(raw.isLicensedBranding ?? raw.IsLicensedBranding)
    };
  }

  async function loadFromDisk() {
    try {
      const url = chrome.runtime.getURL("morobot-branding.json");
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      return normalize(await res.json());
    } catch {
      return null;
    }
  }

  async function getStored() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return normalize(data[STORAGE_KEY]);
  }

  async function resolve() {
    if (cached) return cached;
    cached = (await getStored()) || (await loadFromDisk());
    return cached;
  }

  async function imageDataFromUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    try {
      const res = await fetch(url, { cache: "no-store", mode: "cors" });
      if (!res.ok) return null;
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      const sizes = [16, 32, 48, 128];
      const out = {};
      for (const size of sizes) {
        const canvas = new OffscreenCanvas(size, size);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bmp, 0, 0, size, size);
        out[size] = ctx.getImageData(0, 0, size, size);
      }
      return out;
    } catch {
      return null;
    }
  }

  async function applyAction(branding) {
    if (!branding) return;
    try {
      await chrome.action.setTitle({ title: branding.actionTitle });
    } catch { /* ignore */ }
    const iconUrl = branding.faviconUrl || branding.logoUrl;
    if (!iconUrl) return;
    const imageData = await imageDataFromUrl(iconUrl);
    if (imageData) {
      try {
        await chrome.action.setIcon({ imageData });
      } catch { /* ignore */ }
    }
  }

  async function persist(branding) {
    if (!branding) return;
    cached = branding;
    await chrome.storage.local.set({ [STORAGE_KEY]: branding });
    await applyAction(branding);
    if (globalThis.DaExtI18n && typeof DaExtI18n.setBrand === "function") {
      DaExtI18n.setBrand(branding.appName, branding.brandTitle);
    }
  }

  async function bootstrap() {
    const b = await resolve();
    if (b) await applyAction(b);
    return b;
  }

  return {
    normalize,
    resolve,
    persist,
    bootstrap,
    applyAction
  };
})();

globalThis.DaTenantBranding = DaTenantBranding;
