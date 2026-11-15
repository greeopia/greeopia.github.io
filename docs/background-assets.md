# Homepage backgrounds

- Day: `source/images/tsumugi-day.jpg`, 1600 × 900 (16:9), JPEG quality 92.
- Night: `source/images/miku-heads.jpg`, 3840 × 2160 (16:9).
- Both keep the existing `object-fit: cover`, scroll blur and theme switching.
  Desktop framing stays centered; below 768 px the daytime image uses a 64%
  horizontal focus to keep the girl's face inside portrait screens. The user's
  original `tsumugi.jpg` is retained separately.

The daytime edit used the built-in imagegen tool, followed by JPEG export at
the exact 16:9 website size. The upper-right and lower-left lettering is excluded.

## Imagegen prompt

Edit target: the provided tsumugi.jpg anime illustration (2311 x 1300). Asset:
daytime homepage wallpaper for a Hexo blog. This is a conservative CROP ONLY
task, not a redraw or a stylistic reinterpretation. Create an exact 16:9 landscape
wallpaper, preferably 2048 x 1152 pixels. Crop slightly into the image to exclude
ALL lettering/credits/logos at the upper-right and lower-left outer edges while
keeping the girl, her complete face and blue hair bow, hands, most of her skirt,
the giant teddy bear and existing scene composition. Suggested crop from source:
x=231,y=58,width=2048,height=1152, adjusted minimally if needed to exclude all
corner lettering. Preserve the existing illustration, character identity, pose,
artwork linework, colors, textures, lighting, bear, butterflies and plants
unchanged. Do not repaint, invent, extend the scene, recolor, retouch, add objects
or text. Only a small crop to the existing illustration. Output must be a
rectangular opaque image at aspect ratio 16:9 matching the existing daytime and
nighttime website backgrounds.
