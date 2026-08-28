import urllib.request
import re

url = "https://www.google.com/maps/d/viewer?mid=1iaJeD1JsehFe5L3UfwPx1sUQX6qIbCU"

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
}

try:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8')
        print(f"Successfully downloaded viewer page. Length: {len(html)}")
        
        # Let's save to verify
        with open("C:/Users/willi/.gemini/antigravity/brain/6efde22c-8614-4ca3-baea-16f3b95bcef7/viewer_raw.html", "w", encoding="utf-8") as f:
            f.write(html)
            
        # Search for bootstrap data
        # In Google My Maps, the map data is stored as a JSON string inside:
        # _pageData = "..."
        match = re.search(r'var\s+_pageData\s*=\s*"(.*?)"\s*;', html)
        if match:
            print("Found _pageData!")
            # The JSON data is escaped string inside quotes. Let's decode it.
            data_str = match.group(1)
            # Unescape backslashes and unicode escapes
            decoded = bytes(data_str, "utf-8").decode("unicode_escape")
            with open("C:/Users/willi/.gemini/antigravity/brain/6efde22c-8614-4ca3-baea-16f3b95bcef7/page_data.json", "w", encoding="utf-8") as f:
                f.write(decoded)
            print("Saved unescaped page data JSON.")
        else:
            print("Could not find _pageData in HTML.")
            # Search for any bootstrap data
            bootstrap = re.search(r'bootstrapData\s*=\s*(.*?);', html)
            if bootstrap:
                print("Found bootstrapData!")
                with open("C:/Users/willi/.gemini/antigravity/brain/6efde22c-8614-4ca3-baea-16f3b95bcef7/bootstrap_data.json", "w", encoding="utf-8") as f:
                    f.write(bootstrap.group(1))
            else:
                print("Could not find bootstrapData in HTML.")
except Exception as e:
    print(f"Error: {e}")
