# GPU re-bake of every committed body normal map

Adapter: apple metal-3 apple-m3 (Metal driver on macOS Version 27.0.1 (Build 26A434))

| character | size | GPU bake | texels changed vs committed | of those > 4 codes | > 32 codes | backend parity (300 samples) |
| --- | --- | --- | --- | --- | --- | --- |
| butcher | 512x641 | 1.2 s | 116151 (35.4 %) | 1 (0.0 %) | 0 (0.0 %) | mismatch 0, max 1 codes |
| chair | 512x577 | 5.6 s | 123316 (41.8 %) | 0 (0.0 %) | 0 (0.0 %) | mismatch 0, max 1 codes |
| deadeye | 512x641 | 1.0 s | 118024 (36.0 %) | 0 (0.0 %) | 0 (0.0 %) | mismatch 0, max 1 codes |
| flayer | 512x641 | 0.7 s | 127089 (38.8 %) | 1 (0.0 %) | 0 (0.0 %) | mismatch 0, max 1 codes |
| gamer | 512x1121 | 12.2 s | 247687 (43.2 %) | 42272 (7.4 %) | 20703 (3.6 %) | mismatch 0, max 1 codes |
| gibbet | 512x417 | 3.3 s | 77896 (36.6 %) | 0 (0.0 %) | 0 (0.0 %) | mismatch 0, max 1 codes |
| gorehound | 512x705 | 1.1 s | 129142 (35.8 %) | 0 (0.0 %) | 0 (0.0 %) | mismatch 0, max 1 codes |
| teratoma | 512x257 | 3.1 s | 103563 (79.0 %) | 63250 (48.3 %) | 20935 (16.0 %) | mismatch 0, max 1 codes |
| twinhead | 512x545 | 1.8 s | 106143 (38.1 %) | 18 (0.0 %) | 0 (0.0 %) | mismatch 0, max 1 codes |
| venus | 512x705 | 2.7 s | 120494 (33.4 %) | 7 (0.0 %) | 0 (0.0 %) | mismatch 0, max 1 codes |
