"""Generate PWA icons (pine shield, brass 45). Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw, ImageFont
import os

PINE, PINE2, BRASS, CREAM = (11,32,24), (18,46,35), (201,162,39), (239,231,210)
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)

def font(size):
    for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"]:
        if os.path.exists(f): return ImageFont.truetype(f, size)
    return ImageFont.load_default()

def draw(size, maskable=False):
    img = Image.new("RGBA", (size, size), PINE if maskable else (0,0,0,0))
    d = ImageDraw.Draw(img)
    pad = size*0.2 if maskable else size*0.06
    if not maskable:
        d.rounded_rectangle([0,0,size-1,size-1], radius=size*0.22, fill=PINE)
    # shield
    x0,y0,x1,y1 = pad, pad, size-pad, size-pad
    w,h = x1-x0, y1-y0
    pts=[(x0+w/2,y0),(x1,y0+h*0.14),(x1,y0+h*0.5),(x0+w/2,y1),(x0,y0+h*0.5),(x0,y0+h*0.14)]
    d.polygon(pts, fill=PINE2, outline=BRASS, width=max(2,int(size*0.025)))
    # inner line
    k=0.1
    inner=[(x0+w/2,y0+h*k),(x1-w*k,y0+h*(0.14+k*0.5)),(x1-w*k,y0+h*0.48),(x0+w/2,y1-h*k),(x0+w*k,y0+h*0.48),(x0+w*k,y0+h*(0.14+k*0.5))]
    d.polygon(inner, outline=BRASS+(150,), width=max(1,int(size*0.008)))
    # 45
    f = font(int(size*0.34))
    t="45"
    bb=d.textbbox((0,0),t,font=f)
    tw,th=bb[2]-bb[0],bb[3]-bb[1]
    d.text((size/2-tw/2-bb[0], y0+h*0.42-th/2-bb[1]), t, font=f, fill=BRASS)
    f2=font(int(size*0.09))
    t2="COX"
    bb=d.textbbox((0,0),t2,font=f2)
    d.text((size/2-(bb[2]-bb[0])/2-bb[0], y0+h*0.2-(bb[3]-bb[1])/2-bb[1]), t2, font=f2, fill=CREAM)
    return img

draw(192).save(f"{OUT}/icon-192.png")
draw(512).save(f"{OUT}/icon-512.png")
draw(512, maskable=True).save(f"{OUT}/icon-512-maskable.png")
draw(180).convert("RGB").save(f"{OUT}/apple-touch-icon.png")
# badge: monochrome
b = Image.new("RGBA",(96,96),(0,0,0,0)); d=ImageDraw.Draw(b)
d.polygon([(48,4),(92,18),(92,52),(48,92),(4,52),(4,18)], fill=(255,255,255,255))
f=font(40); bb=d.textbbox((0,0),"45",font=f)
d.text((48-(bb[2]-bb[0])/2-bb[0], 44-(bb[3]-bb[1])/2-bb[1]),"45",font=f,fill=(0,0,0,0))
b.save(f"{OUT}/badge-96.png")
print("icons written to", OUT)
