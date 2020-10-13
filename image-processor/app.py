import os

import boto3
from json import dumps

KNOWN_STYLES = {'Stout', 'Lager'}

rekognition = boto3.client('rekognition')
sns = boto3.client('sns')


def handler(event, context):
    topic_arn = os.environ.get('TOPIC_ARN')

    print('Topic: %s' % topic_arn)
    print('Event: %s' % dumps(event))

    if not topic_arn:
        raise ValueError('TOPIC_ARN must be set')

    images = []
    for record in event['Records']:
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']
        if key.startswith('thumbs'):
            continue

        response = rekognition.detect_labels(
            Image={
                'S3Object': {
                    'Bucket': bucket,
                    'Name': key
                }
            },
            MinConfidence=70
        )

        print("Response from Rekognition: %s" % dumps(response))

        labels = [label['Name'] for label in response['Labels']]

        print('Image %s had labels: %s' % (key, labels))

        style = next((label for label in labels if label in KNOWN_STYLES), "")

        thumb_name = 'thumb/%s.png' % key[0:str(key).rindex('.')]
        payload = '{ "key": "%s", "thumbName": "%s", "isBeer": %s, "style": "%s"}' % (key, thumb_name, str('Beer' in labels).lower(), style)
        print(payload)
        sns.publish(TopicArn=topic_arn, Message=payload)

    return dumps(images)
