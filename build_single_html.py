#!/usr/bin/env python3
"""Build one self-contained HTML file (styles, script, content and photos built in).

    python3 tools/build_single_html.py            -> dist/meo-website.html

Use it for sharing a preview or for hosts without the C++ server. Forms then open the
visitor's email app with their details instead of saving to the server."""
import base64, json, mimetypes, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
pub = root / 'public'

def data_uri(rel):
    p = pub / rel
    mime = mimetypes.guess_type(p.name)[0] or ('image/webp' if p.suffix == '.webp' else 'application/octet-stream')
    return f'data:{mime};base64,' + base64.b64encode(p.read_bytes()).decode()

content = json.loads((root / 'data' / 'content.json').read_text(encoding='utf-8'))
def embed(o):
    if isinstance(o, dict): return {k: embed(v) for k, v in o.items()}
    if isinstance(o, list): return [embed(v) for v in o]
    if isinstance(o, str) and o.startswith('assets/') and (pub / o).exists(): return data_uri(o)
    return o
images = {}
def collect(o):
    if isinstance(o, dict): [collect(v) for v in o.values()]
    elif isinstance(o, list): [collect(v) for v in o]
    elif isinstance(o, str) and o.startswith('assets/') and (pub / o).exists(): images.setdefault(o, data_uri(o))
collect(content)

html = (pub / 'index.html').read_text(encoding='utf-8')
css = (pub / 'css' / 'style.css').read_text(encoding='utf-8')
js = (pub / 'js' / 'app.js').read_text(encoding='utf-8')

html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n' + css + '\n</style>')
payload = (json.dumps(content, ensure_ascii=False) + ';window.MEO_IMG=' + json.dumps(images)
           + ';(function f(o){for(var k in o){var v=o[k];if(typeof v==="string"&&MEO_IMG[v])o[k]=MEO_IMG[v];else if(v&&typeof v==="object")f(v)}})(window.MEO_CONTENT)'
           ).replace('</', '<\\/')
html = html.replace('<script src="js/app.js" defer></script>',
                    '<script>window.MEO_CONTENT=' + payload + ';</script>\n<script>\n'
                    + js.replace('</script', '<\\/script') + '\n</script>')
# the script is now inline and runs immediately, so move it to the end of <body>
head_scripts = re.findall(r'<script>window\.MEO_CONTENT=.*?</script>\n<script>\n.*?\n</script>', html, flags=re.S)
for s in head_scripts:
    html = html.replace(s, '')
    html = html.replace('</body>', s + '\n</body>')
html = re.sub(r'(src|href|content)="(assets/[^"]+)"', lambda m: f'{m.group(1)}="{data_uri(m.group(2))}"', html)

out = root / 'dist' / 'meo-website.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'{out}  ({out.stat().st_size/1024:.0f} KB)')
