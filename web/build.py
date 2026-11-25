from pathlib import Path
root = Path(__file__).resolve().parent
bundle = (root.parent / "ui" / "dist" / "moscow-planner.js").read_text()
bundle = bundle.replace("</script", "<\\/script")
html = (root / "template.html").read_text().replace("/*BUNDLE*/", bundle)
(root / "index.html").write_text(html)
print("index.html", len(html) // 1024, "KB")
