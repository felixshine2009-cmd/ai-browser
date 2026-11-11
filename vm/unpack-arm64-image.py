#!/usr/bin/env python3
"""Extract the raw arm64 Image from an EFI zboot kernel (MZ 'zimg' header, gzip/zstd payload).
Apple Virtualization.framework's Linux boot loader needs the uncompressed Image."""
import struct, sys, gzip, subprocess
src, dst = sys.argv[1], sys.argv[2]
d = open(src, 'rb').read()
if d[4:8] != b'zimg':
    sys.exit('not an EFI zboot image')
off, size = struct.unpack('<II', d[8:16])
kind = d[24:32].rstrip(b'\0').decode()
payload = d[off:off + size]
if kind == 'gzip':
    raw = gzip.decompress(payload)
elif kind == 'zstd':
    raw = subprocess.run(['zstd', '-dc'], input=payload, capture_output=True, check=True).stdout
else:
    sys.exit('unsupported compression ' + kind)
if raw[56:60] != b'ARM\x64':
    sys.exit('payload is not an arm64 Image')
open(dst, 'wb').write(raw)
print('arm64 Image', len(raw), 'bytes')
