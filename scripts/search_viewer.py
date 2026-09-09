import re

with open("C:/Users/willi/.gemini/antigravity/brain/6efde22c-8614-4ca3-baea-16f3b95bcef7/viewer_raw.html", "r", encoding="utf-8") as f:
    html = f.read()

# Let's search for the map ID
print("Occurrences of map ID:")
for m in re.finditer(r'1iaJeD1JsehFe5L3UfwPx1sUQX6qIbCU', html):
    start = max(0, m.start() - 100)
    end = min(len(html), m.end() + 200)
    print(f"Index {m.start()}:")
    print(html[start:end])
    print("-" * 50)
