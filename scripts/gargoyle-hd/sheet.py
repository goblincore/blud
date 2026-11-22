import sys
from PIL import Image
out=sys.argv[1]; rows=sys.argv[2:]
views=['front','q34','side','back']
ims=[[Image.open(f'{r}-{v}.png').convert('RGB') for v in views] for r in rows]
w,h=ims[0][0].size; s=Image.new('RGB',(w*4,h*len(rows)))
for y,row in enumerate(ims):
    for x,im in enumerate(row): s.paste(im,(x*w,y*h))
s.resize((w*4*45//100,h*len(rows)*45//100)).save(out)
