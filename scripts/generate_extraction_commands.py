#!/usr/bin/env python3
import sys
import math

def main():
    missing_picnums_str = sys.stdin.read()
    try:
        # Filter out any non-numeric lines
        missing_picnums = [int(line) for line in missing_picnums_str.strip().splitlines() if line.strip().isdigit()]
    except ValueError:
        print("Error: Could not parse picnums from stdin.", file=sys.stderr)
        sys.exit(1)

    art_files_to_extract = set()
    for picnum in missing_picnums:
        if picnum >= 0:
            art_index = math.floor(picnum / 256)
            art_files_to_extract.add(art_index)

    blood_dir = "/Users/donny/Documents/Raze/blood"
    out_dir = "/tmp/blud-vision-extract"
    
    print(f"mkdir -p {out_dir}")
    
    for art_index in sorted(list(art_files_to_extract)):
        art_file = f"tiles{art_index:03d}.art"
        command = (
            f"python3 scripts/extract_blood_sprites.py {blood_dir} "
            f"--art {art_file} --out {out_dir}"
        )
        print(command)
        
    print(f"cp {out_dir}/*.png public/assets/blood-tiles/")

if __name__ == "__main__":
    main()
