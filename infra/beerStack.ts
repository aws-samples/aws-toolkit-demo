import * as cdk from '@aws-cdk/core'
import {PythonFunction} from "@aws-cdk/aws-lambda-python"
import {Runtime} from "@aws-cdk/aws-lambda"
import {DatabaseInstance, DatabaseInstanceEngine} from "@aws-cdk/aws-rds"
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  ISecurityGroup,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc
} from "@aws-cdk/aws-ec2"
import {MysqlEngineVersion} from "@aws-cdk/aws-rds/lib/instance-engine"
import {Bucket, EventType} from "@aws-cdk/aws-s3";
import {Topic} from "@aws-cdk/aws-sns";
import {ContainerImage, IService} from "@aws-cdk/aws-ecs";
import {ApplicationLoadBalancedFargateService} from "@aws-cdk/aws-ecs-patterns";
import {DockerImageAsset} from "@aws-cdk/aws-ecr-assets";
import * as path from "path";
import {S3EventSource, SnsEventSource} from "@aws-cdk/aws-lambda-event-sources";
import {IFunction} from "@aws-cdk/aws-lambda/lib/function-base";
import {ManagedPolicy} from '@aws-cdk/aws-iam'
import {Distribution} from "@aws-cdk/aws-cloudfront";
import {S3Origin} from "@aws-cdk/aws-cloudfront-origins";
import {IDistribution} from "@aws-cdk/aws-cloudfront/lib/distribution";
import {NodejsFunction} from "@aws-cdk/aws-lambda-nodejs";
import {Duration} from "@aws-cdk/core";
import {Repository} from "@aws-cdk/aws-ecr";


const DB_PORT = 3306
const WEB_PORT = 80
const DB_NAME = 'main'
const PREFIX_LIST: string | undefined = undefined // Use this if you want to restrict access to a Prefix List
const ECS_DEBUG = true // Configure permissions required for ECS Cloud Debug

export class BeerStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    let vpc = new Vpc(this, 'VPC', {
      subnetConfiguration: [
        {
          name: 'CommonPublicSubnetGroup',
          subnetType: SubnetType.PUBLIC,
        },
        {
          name: 'CommonPrivateSubnetGroup',
          subnetType: SubnetType.PRIVATE,
        },
      ]
    })
    let dbInstance = this.createDatabaseInstance(vpc);

    let imageUpload = new Bucket(this, 'ImageUpload')
    let imageStorage = new Bucket(this, 'ImageStorage')
    let labelsTopic = new Topic(this, 'LabelsTopic')

    this.createMetadataStorageFunction(labelsTopic, vpc, dbInstance)
    this.createImageProcessFunction(labelsTopic, imageUpload)
    this.createImageResizeFunction(labelsTopic, imageUpload, imageStorage)
    let cdn = this.configureCloudFront(imageStorage)
    this.createWebFrontend(vpc, cdn, dbInstance, imageUpload);
  }

  private createWebFrontend(vpc: Vpc, cdn: IDistribution, db: DatabaseInstance, uploadBucket: Bucket): IService {
    let webServiceImage = new DockerImageAsset(this, 'WebServiceImage', {
      directory: path.join(__dirname, '..', 'web')
    })

    let fargate = new ApplicationLoadBalancedFargateService(this, 'WebService', {
      vpc,
      desiredCount: 5,
      publicLoadBalancer: true,
      listenerPort: WEB_PORT,
      taskImageOptions: {
        image: ContainerImage.fromDockerImageAsset(webServiceImage),
        environment: {
          'CDN_DOMAIN': cdn.distributionDomainName,
          'DB_SECRET': db.secret!!.secretArn,
          'UPLOAD_BUCKET': uploadBucket.bucketName
        }
      },
      securityGroups: [this.createPublicIngressSecurityGroup('WebServiceSecurityGroup', vpc, WEB_PORT)],
    })

    fargate.targetGroup.configureHealthCheck({
      timeout: Duration.seconds(30),
      interval: Duration.seconds(60),
      path: '/actuator/health'
    })
    fargate.loadBalancer.addSecurityGroup(this.createPublicIngressSecurityGroup('LoadBalancerSecurityGroup', vpc, WEB_PORT))
    db.secret?.grantRead(fargate.service.taskDefinition.taskRole)
    db.connections.allowDefaultPortFrom(fargate.service)
    uploadBucket.grantPut(fargate.service.taskDefinition.taskRole)

    if (ECS_DEBUG) {
      let repo = Repository.fromRepositoryArn(this, 'cloud-debug-repo', "arn:aws:ecr:us-west-2:831759287394:repository/amberwing-sidecar")
      repo.grantPull(fargate.taskDefinition.executionRole!!)
      fargate.taskDefinition.taskRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"))
    }
    return fargate.service
  }

  private createImageProcessFunction(labelsTopic: Topic, bucket: Bucket): IFunction {
    let imageProcessFunction = new PythonFunction(this, 'ProcessImage', {
      entry: '../image-processor',
      index: 'app.py',
      runtime: Runtime.PYTHON_3_8,
      timeout: Duration.seconds(30),
      environment: {
        'TOPIC_ARN': labelsTopic.topicArn
      },
      deadLetterQueueEnabled: true
    })

    bucket.grantRead(imageProcessFunction)
    labelsTopic.grantPublish(imageProcessFunction)
    imageProcessFunction.role?.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("AmazonRekognitionReadOnlyAccess"))

    imageProcessFunction.addEventSource(new S3EventSource(bucket, {
      events: [EventType.OBJECT_CREATED]
    }))
    return imageProcessFunction
  }

  private createImageResizeFunction(labelsTopic: Topic, uploadBucket: Bucket, storageBucket: Bucket): IFunction {
    let imageResizeFunction = new PythonFunction(this, 'ResizeImage', {
      entry: '../image-resizer',
      index: 'handler.py',
      handler: 'handler',
      runtime: Runtime.PYTHON_3_8,
      timeout: Duration.seconds(30),
      environment: {
        'UPLOAD_BUCKET': uploadBucket.bucketName,
        'STORAGE_BUCKET': storageBucket.bucketName
      },
      deadLetterQueueEnabled: true,
    })
    uploadBucket.grantRead(imageResizeFunction)
    uploadBucket.grantDelete(imageResizeFunction)
    storageBucket.grantWrite(imageResizeFunction)

    imageResizeFunction.addEventSource(new SnsEventSource(labelsTopic))
    return imageResizeFunction
  }

  private createDatabaseInstance(vpc: Vpc): DatabaseInstance {
    let secGroup = this.createPublicIngressSecurityGroup('DatabaseSecurityGroup', vpc, DB_PORT)

    return new DatabaseInstance(this, 'ImageMetadata', {
      instanceType: InstanceType.of(InstanceClass.M5, InstanceSize.XLARGE),
      engine: DatabaseInstanceEngine.mysql({
        version: MysqlEngineVersion.VER_8_0
      }),
      databaseName: DB_NAME,
      port: DB_PORT,
      securityGroups: [secGroup],
      vpc,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC
      },
      iamAuthentication: true,
    })
  }

  private createPublicIngressSecurityGroup(id: string, vpc: Vpc, port: number): ISecurityGroup {
    let group = new SecurityGroup(this, id, {
      vpc
    })

    let peer = PREFIX_LIST ? Peer.prefixList(PREFIX_LIST) : Peer.anyIpv4()

    group.addIngressRule(peer, Port.tcp(port))

    return group
  }

  private configureCloudFront(imageStorage: Bucket): IDistribution {
    return new Distribution(this, 'WebsiteCDN', {
      defaultBehavior: { origin: new S3Origin(imageStorage) }
    })
  }

  private createMetadataStorageFunction(labelsTopic: Topic, vpc: Vpc, dbInstance: DatabaseInstance) {
    let metadataStorageFunction = new NodejsFunction(this, 'MetadataStorage', {
      entry: '../metadata-storage/src/index.ts',
      runtime: Runtime.NODEJS_12_X,
      timeout: Duration.seconds(30),
      environment: {
        'DB_SECRET': dbInstance.secret!.secretArn
      },
      vpc,
      deadLetterQueueEnabled: true
    })
    metadataStorageFunction.addEventSource(new SnsEventSource(labelsTopic))
    dbInstance.secret?.grantRead(metadataStorageFunction)
    dbInstance.connections.allowDefaultPortFrom(metadataStorageFunction)
  }
}
