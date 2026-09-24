/**
 * Morobot crypto + .mrbt codec (AES-256-GCM via Web Crypto).
 *
 * Tonight: one GLOBAL key for all users (DaCrypto.GLOBAL_KEY_MATERIAL).
 * Changing that material invalidates every stored blob and .mrbt file.
 *
 * FUTURE (not implemented — design only):
 * - After a paid plan: server issues UserPlanKey with expiresAt (e.g. 30 days).
 *   Renewal extends expiry; after expiry decrypt fails → user loses access to local blobs
 *   until they renew / recover with Suras global key.
 * - Envelope: random DEK per process/blob → encrypt payload with DEK;
 *   wrap DEK with UserPlanKey AND optionally with GlobalSurasKey (so sharing /
 *   support can open any process without knowing the user key).
 * - Sharing between users: wrap the same DEK for recipient (their UserPlanKey
 *   or a temporary share wrap). Recipient decrypts DEK then payload.
 * - If only UserPlanKey wraps DEK and it expires, GlobalSurasKey wrap is the
 *   recovery / interchange path — that is the intended dual-wrap model.
 */
(function (global) {
  const MAGIC = "MRBT";
  const VERSION = 1;
  const KEY_KIND_GLOBAL = 0;
  /** Global key for current MVP — replace/rotate only when intentional data reset is OK. */
  const GLOBAL_KEY_MATERIAL = "Morobot/Suras/GlobalKey/v1/CHANGE-IN-PROD-2026";
  const LS_PREFIX = "mrbt1:";

  function b64FromBytes(bytes) {
    let s = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }

  function bytesFromB64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function utf8Encode(str) {
    return new TextEncoder().encode(str);
  }

  function utf8Decode(bytes) {
    return new TextDecoder().decode(bytes);
  }

  let _keyPromise = null;

  async function getGlobalKey() {
    if (_keyPromise) return _keyPromise;
    _keyPromise = (async () => {
      const material = utf8Encode(GLOBAL_KEY_MATERIAL);
      const hash = await crypto.subtle.digest("SHA-256", material);
      return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    })();
    return _keyPromise;
  }

  async function encryptBytes(plainBytes) {
    const key = await getGlobalKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainBytes);
    const ctArr = new Uint8Array(ct);
    const out = new Uint8Array(1 + 1 + iv.length + ctArr.length);
    out[0] = VERSION;
    out[1] = KEY_KIND_GLOBAL;
    out.set(iv, 2);
    out.set(ctArr, 14);
    return out;
  }

  async function decryptBytes(blob) {
    const data = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    if (data.length < 15) throw new Error("MRBT_CORRUPT");
    const ver = data[0];
    const kind = data[1];
    if (ver !== VERSION) throw new Error("MRBT_VERSION");
    if (kind !== KEY_KIND_GLOBAL) throw new Error("MRBT_KEY_KIND");
    const iv = data.slice(2, 14);
    const ct = data.slice(14);
    const key = await getGlobalKey();
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
      return new Uint8Array(plain);
    } catch {
      throw new Error("MRBT_DECRYPT"); // wrong key / tampered
    }
  }

  async function encryptJson(obj) {
    const json = typeof obj === "string" ? obj : JSON.stringify(obj);
    const packed = await encryptBytes(utf8Encode(json));
    return LS_PREFIX + b64FromBytes(packed);
  }

  async function decryptJson(stored) {
    if (stored == null || stored === "") return null;
    const s = String(stored);
    if (!s.startsWith(LS_PREFIX)) {
      // Legacy plaintext JSON — caller may migrate.
      throw new Error("MRBT_PLAIN");
    }
    const packed = bytesFromB64(s.slice(LS_PREFIX.length));
    const plain = await decryptBytes(packed);
    return JSON.parse(utf8Decode(plain));
  }

  function looksEncrypted(stored) {
    return typeof stored === "string" && stored.startsWith(LS_PREFIX);
  }

  /** Build .mrbt file text (UTF-8). */
  async function encodeMrbtFile(payloadObj) {
    const packed = await encryptBytes(utf8Encode(JSON.stringify(payloadObj)));
    return `${MAGIC}/${VERSION}\n${b64FromBytes(packed)}\n`;
  }

  /** Parse .mrbt file text or legacy JSON string → object. */
  async function decodeMrbtFile(text) {
    const raw = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!raw) throw new Error("MRBT_EMPTY");
    if (raw.startsWith("{") || raw.startsWith("[")) {
      // Legacy JSON import still accepted once, then re-saved as .mrbt.
      return JSON.parse(raw);
    }
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length || !lines[0].startsWith(`${MAGIC}/`)) throw new Error("MRBT_MAGIC");
    const ver = Number(lines[0].split("/")[1] || 0);
    if (ver !== VERSION) throw new Error("MRBT_VERSION");
    const b64 = lines.slice(1).join("");
    const plain = await decryptBytes(bytesFromB64(b64));
    return JSON.parse(utf8Decode(plain));
  }

  global.DaCrypto = {
    MAGIC,
    VERSION,
    LS_PREFIX,
    GLOBAL_KEY_MATERIAL,
    encryptJson,
    decryptJson,
    looksEncrypted,
    encodeMrbtFile,
    decodeMrbtFile,
    encryptBytes,
    decryptBytes
  };
})(typeof window !== "undefined" ? window : globalThis);
