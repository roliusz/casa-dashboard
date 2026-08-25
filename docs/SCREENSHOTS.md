# Capturing the screenshots

The README references four images. They are taken from the demo harness rather than a real house,
so nothing personal ships in the repository — the harness invents its own entities.

Start the harness:

    python3 -m http.server 8777
    # then open http://localhost:8777/dev/

Set the browser window to **1500 × 950** and use a dark desktop background: the dashboard is
translucent, and whatever is behind the window shows through the glass at the edges.

Capture with ⌘⇧4 then Space to grab just the window (macOS drops the drop-shadow with ⌥ held), and
save into `docs/` under these exact names.

| File | What to show | How to get there |
|---|---|---|
| `hero.png` | the dashboard at rest, nothing in edit mode | load the harness, pick the **Home** tab |
| `editing.png` | edit mode, so the pencils and add buttons are visible | press the pencil in the top right |
| `widgets.png` | the widget picker, showing the previews | edit mode → **+ Add card** → **Widgets** |
| `settings.png` | the settings sheet | press the cog |
| `group-tab.png` | a group tab sorted into rooms, with its filter chips | add a **+ Group tab** and choose some entities |
| `widget-tab.png` | a tab of widgets, to show what they look like in use | build a tab from the widget picker |

After capturing, round the corners and bring them down to a sensible width — 1860px is plenty, and
keeps the whole set under about 6 MB:

    python3 - <<'EOF'
    from PIL import Image, ImageDraw
    import glob
    for f in glob.glob("docs/*.png"):
        im = Image.open(f).convert("RGBA")
        if im.width > 1860:
            im = im.resize((1860, round(im.height * 1860 / im.width)), Image.LANCZOS)
        w, h = im.size
        r = max(12, round(min(w, h) * 0.022))
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=r, fill=255)
        im.putalpha(Image.composite(im.getchannel("A"), Image.new("L", (w, h), 0), mask))
        im.save(f)
    EOF

Keep them under about 400 KB each — `pngquant --quality 65-80` is enough, and the glass gradients
survive it well.

If you would rather shoot a real dashboard, check the frame for room names, media titles, people
and camera stills before committing it.
