from pathlib import Path

from PIL import Image


SOURCE = Path("/home/ubuntu/webdev-static-assets/fsvod-icon.png")
TARGETS = [
    Path("/home/ubuntu/fsvod-mobile/assets/images/icon.png"),
    Path("/home/ubuntu/fsvod-mobile/assets/images/splash-icon.png"),
    Path("/home/ubuntu/fsvod-mobile/assets/images/favicon.png"),
    Path("/home/ubuntu/fsvod-mobile/assets/images/android-icon-foreground.png"),
]


def main() -> None:
    with Image.open(SOURCE) as image:
        optimized = image.convert("RGBA")
        optimized.thumbnail((512, 512), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (512, 512), (11, 16, 32, 255))
        offset = ((512 - optimized.width) // 2, (512 - optimized.height) // 2)
        canvas.alpha_composite(optimized, offset)
        for target in TARGETS:
            canvas.save(target, format="PNG", optimize=True, compress_level=9)
            print(f"{target.name}: {target.stat().st_size} bytes")


if __name__ == "__main__":
    main()
