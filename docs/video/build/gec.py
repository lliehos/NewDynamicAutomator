"""Generate the Edge TTS Sec-MS-GEC token (v2) and MUID.

Ports nothing: it loads the upstream edge-tts `drm.py` (fetched to _ref_drm.py)
with its aiohttp / relative-import dependencies stubbed out, so the exact
CS64+SHA256 token algorithm stays byte-identical to upstream.

Usage: python gec.py            -> prints "gec muid" on one line
"""

import os
import secrets
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"

# --- stub aiohttp, used only for an exception annotation in drm.py ---
aiohttp_stub = types.ModuleType("aiohttp")


class _ClientResponseError(Exception):
    headers = None


aiohttp_stub.ClientResponseError = _ClientResponseError
sys.modules.setdefault("aiohttp", aiohttp_stub)

src_path = os.path.join(HERE, "_ref_drm.py")
if not os.path.exists(src_path):
    sys.exit("missing _ref_drm.py (fetch it from the edge-tts repo)")

source = open(src_path, encoding="utf-8").read()
source = source.replace(
    "from .constants import TRUSTED_CLIENT_TOKEN",
    f"TRUSTED_CLIENT_TOKEN = {TRUSTED_CLIENT_TOKEN!r}",
)
source = source.replace(
    "from .exceptions import SkewAdjustmentError",
    "class SkewAdjustmentError(Exception):\n    pass",
)

namespace: dict = {"__name__": "drm_standalone"}
exec(compile(source, src_path, "exec"), namespace)
DRM = namespace["DRM"]

gec = DRM.generate_sec_ms_gec()
muid = secrets.token_hex(16).upper()
print(gec, muid, sep=" ")
