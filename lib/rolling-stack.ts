import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';
import { BgTestNetworkStack } from './network-stack';
import { BgTestDataStack } from './data-stack';
import { BgTestEcrStack } from './ecr-stack';
import { LAB_CONFIG } from './config';

export interface BgTestRollingStackProps extends cdk.StackProps {
  networkStack: BgTestNetworkStack;
  dataStack: BgTestDataStack;
  ecrStack: BgTestEcrStack;
  cloudFrontPrefixListId: string;
  launchVersion: 'v1' | 'v2';
  targetSubnet: 'private1' | 'private2';
}

export class BgTestRollingStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly tg: elbv2.ApplicationTargetGroup;
  public readonly secret: string;
  public readonly albSg: ec2.SecurityGroup;
  public readonly asg: autoscaling.AutoScalingGroup;
  public readonly lt: ec2.LaunchTemplate;
  public readonly instanceSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: BgTestRollingStackProps) {
    super(scope, id, props);
    const vpc = props.networkStack.vpc;

    const albSg = new ec2.SecurityGroup(this, 'RollingAlbSg', {
      vpc, allowAllOutbound: true,
      securityGroupName: 'bg-rolling-alb-sg',
      description: 'Rolling ALB SG',
    });

    new ec2.CfnSecurityGroupIngress(this, 'RollingAlbIngress', {
      groupId: albSg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 80,
      toPort: 80,
      sourcePrefixListId: props.cloudFrontPrefixListId,
      description: 'HTTP from CloudFront origin-facing only',
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'RollingAlb', {
      vpc, internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: 'bg-rolling-alb',
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const tg = new elbv2.ApplicationTargetGroup(this, 'RollingTg', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      targetGroupName: 'bg-rolling-tg',
      healthCheck: {
        path: '/health',
        port: 'traffic-port',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
      },
    });

    const listener = alb.addListener('RollingListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Access Denied',
      }),
    });

    const secret = `bg-rolling-${this.account}-${cdk.Names.uniqueId(this).slice(-6)}`;
    new elbv2.CfnListenerRule(this, 'RollingForwardRule', {
      listenerArn: listener.listenerArn,
      priority: 1,
      conditions: [{
        field: 'http-header',
        httpHeaderConfig: { httpHeaderName: 'X-Custom-Secret', values: [secret] },
      }],
      actions: [{
        type: 'forward',
        forwardConfig: { targetGroups: [{ targetGroupArn: tg.targetGroupArn, weight: 1 }] },
      }],
    });

    const subnets = props.targetSubnet === 'private1'
      ? props.networkStack.private1Subnets
      : props.networkStack.private2Subnets;
    if (subnets.length === 0) {
      throw new Error(`No subnets for targetSubnet=${props.targetSubnet}. Set includeSecondaryCidr=true.`);
    }

    const instanceSg = new ec2.SecurityGroup(this, 'RollingInstanceSg', {
      vpc, allowAllOutbound: true,
      securityGroupName: 'bg-rolling-instance-sg',
    });

    const role = new iam.Role(this, 'RollingAsgRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });
    props.dataStack.dbSecret.grantRead(role);

    const imageTag = props.launchVersion;
    const colorEnv = props.launchVersion === 'v1' ? 'blue' : 'green';
    const imageUri = `${props.ecrStack.repository.repositoryUri}:${imageTag}`;

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      'dnf install -y docker',
      'systemctl enable --now docker',
      `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
      `DB_PASS=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id ${props.dataStack.dbSecret.secretArn} --query SecretString --output text | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')`,
      `docker run -d --restart=always --name app -p 80:${LAB_CONFIG.compute.appPort} \\`,
      `  -e COLOR=${colorEnv} \\`,
      `  -e VERSION=${imageTag} \\`,
      '  -e COMPUTE_TYPE=ec2-rolling \\',
      `  -e REDIS_URL=rediss://${props.dataStack.redisReplicationGroup.attrPrimaryEndPointAddress}:6379 \\`,
      `  -e DB_HOST=${props.dataStack.auroraCluster.clusterEndpoint.hostname} \\`,
      `  -e DB_USER=${LAB_CONFIG.data.dbUser} \\`,
      `  -e DB_NAME=${LAB_CONFIG.data.dbName} \\`,
      `  -e AWS_REGION=${this.region} \\`,
      '  -e DB_PASSWORD="$DB_PASS" \\',
      `  ${imageUri}`,
    );

    const lt = new ec2.LaunchTemplate(this, 'RollingLt', {
      launchTemplateName: 'bg-rolling-lt',
      instanceType: new ec2.InstanceType(LAB_CONFIG.compute.ec2InstanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      role, securityGroup: instanceSg, userData,
    });

    const asg = new autoscaling.AutoScalingGroup(this, 'RollingAsg', {
      vpc, vpcSubnets: { subnets },
      launchTemplate: lt,
      desiredCapacity: 4,
      minCapacity: 4,
      maxCapacity: 8,
      healthCheck: autoscaling.HealthCheck.elb({ grace: cdk.Duration.minutes(5) }),
      autoScalingGroupName: 'bg-rolling-ec2asg',
    });

    const cfnAsg = asg.node.defaultChild as autoscaling.CfnAutoScalingGroup;
    cfnAsg.targetGroupArns = [tg.targetGroupArn];

    this.asg = asg;
    this.lt = lt;
    this.instanceSg = instanceSg;

    this.alb = alb;
    this.tg = tg;
    this.secret = secret;
    this.albSg = albSg;
  }
}
