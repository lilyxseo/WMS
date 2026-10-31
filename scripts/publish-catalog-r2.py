#!/usr/bin/env python3
"""Upload content-addressed rasters first and publish the manifest last."""
import argparse, json, mimetypes, os, re
from pathlib import Path

def publish(directory,bucket,endpoint,client=None):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]',bucket): raise ValueError('Invalid bucket')
    if not re.fullmatch(r'https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com',endpoint): raise ValueError('Invalid R2 S3 endpoint')
    if client is None:
        if not os.environ.get('AWS_ACCESS_KEY_ID') or not os.environ.get('AWS_SECRET_ACCESS_KEY'): raise ValueError('Configure GitHub R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY secrets')
        import boto3
        client=boto3.client('s3',endpoint_url=endpoint,region_name='auto')
    directory=Path(directory);manifest=json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('version')!=1 or not manifest.get('images'): raise ValueError('Empty/invalid manifest')
    paths={entry['path'] for entry in manifest['images']}
    for path in sorted(paths):
        if not re.fullmatch(r'images/[a-f0-9]{64}\.(png|jpg|gif|webp)',path): raise ValueError('Invalid image path')
        with (directory/path).open('rb') as image: client.put_object(Bucket=bucket,Key='catalog-images/'+path,Body=image,ContentType=mimetypes.guess_type(path)[0] or 'application/octet-stream',CacheControl='public,max-age=31536000,immutable')
    client.put_object(Bucket=bucket,Key='catalog-images/manifest.json',Body=(directory/'manifest.json').read_bytes(),ContentType='application/json',CacheControl='public,max-age=60')
    print('Published mapped images:',len(manifest['images']))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--directory',required=True);parser.add_argument('--bucket',default='bydrz');args=parser.parse_args();publish(args.directory,args.bucket,os.environ.get('R2_ENDPOINT',''))
