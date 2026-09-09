import urllib.request

url = "https://www.google.com/maps/d/u/0/kml?forcekml=1&mid=1iaJeD1JsehFe5L3UfwPx1sUQX6qIbCU"

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

try:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as response:
        content = response.read()
        print(f"Success! Downloaded {len(content)} bytes")
        with open("C:/Users/willi/.gemini/antigravity/brain/6efde22c-8614-4ca3-baea-16f3b95bcef7/mymap.kml", "wb") as f:
            f.write(content)
except Exception as e:
    print(f"Error: {e}")
