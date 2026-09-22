# -*- coding: utf-8 -*-
import re
import subprocess
from pathlib import Path

root = Path(r"d:\Projects\Web\NewDaynamicAutomator\NewDynamicAutomator")
p = root / "src/DynamicAutomator.Web/wwwroot/editor/flow.js"
data = subprocess.check_output(
    ["git", "show", "HEAD:src/DynamicAutomator.Web/wwwroot/editor/flow.js"],
    cwd=root,
)
text = data.decode("utf-8")
text = text.replace("/Tasks/", "/Panel/Tasks/").replace("/Panel/Panel/", "/Panel/")
p.write_text(text, encoding="utf-8", newline="\n")
m = re.search(r'NoAction:\s*"([^"]+)"', text)
print("SAMPLE=", m.group(1) if m else "NONE")
print("Panel=", "/Panel/Tasks/" in text)
print("len=", len(text))
