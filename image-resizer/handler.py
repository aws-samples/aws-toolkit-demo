from PIL import Image
import os
import boto3
import json
from io import BytesIO

STORAGE_BUCKET = os.getenv('STORAGE_BUCKET')
UPLOAD_BUCKET = os.getenv('UPLOAD_BUCKET')
MAX_SIZE = 200

s3 = boto3.resource('s3')


def handler(event, context):
    print(event)
    image_data = json.loads(event['Records'][0]['Sns']['Message'])
    source_key = image_data['key']
    target_key = image_data['thumbName']
    source_obj = s3.Object(bucket_name=UPLOAD_BUCKET, key=source_key)
    obj_body = source_obj.get()['Body'].read()
    with Image.open(BytesIO(obj_body)) as img:
        img.thumbnail((MAX_SIZE, MAX_SIZE))
        target_buffer = BytesIO()

        img.save(target_buffer, 'PNG')
        target_buffer.seek(0)

        print('Resized, storing to %s' % target_key)
        target_obj = s3.Object(bucket_name=STORAGE_BUCKET, key=target_key)
        target_obj.put(Body=target_buffer, ContentType='image/png')
    print('Deleting source %s from bucket %s' % (source_key, UPLOAD_BUCKET))
    source_obj.delete()
    return target_key
