#!/usr/bin/env python3
import argparse, urllib.request, urllib.parse
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);parser.add_argument('--output',required=True);args=parser.parse_args();url=urllib.parse.urlparse(args.url)
if url.scheme!='https' or not url.hostname or not url.hostname.endswith('.r2.dev') or url.username or url.password: raise ValueError('Expected public HTTPS R2 source')
output=Path(args.output);size=0
try:
    with urllib.request.urlopen(args.url,timeout=60) as response,output.open('wb') as target:
        if response.geturl()!=args.url: raise ValueError('Unexpected workbook redirect')
        while True:
            chunk=response.read(1024*1024)
            if not chunk: break
            size+=len(chunk)
            if size>256*1024**2: raise ValueError('Workbook exceeds 256 MiB')
            target.write(chunk)
    print('Downloaded workbook bytes:',size)
except Exception:
    output.unlink(missing_ok=True)
    raise
