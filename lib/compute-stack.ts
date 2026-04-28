import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';
import { BgTestNetworkStack } from './network-stack';
import { BgTestDataStack } from './data-stack';
import { BgTestEcrStack } from './ecr-stack';
import { BgTestClusterStack } from './cluster-stack';

export type Color = 'blue' | 'green';
export type ComputeSubnetGroup = 'private1' | 'private2';

export interface BgTestComputeStackProps extends cdk.StackProps {
  color: Color;
  computeSubnetGroup: ComputeSubnetGroup;
  networkStack: BgTestNetworkStack;
  dataStack: BgTestDataStack;
  ecrStack: BgTestEcrStack;
  clusterStack: BgTestClusterStack;
  cloudFrontPrefixListId: string;
}

interface AlbBundle {
  alb: elbv2.ApplicationLoadBalancer;
  listener: elbv2.ApplicationListener;
  tg: elbv2.ApplicationTargetGroup;
  secret: string;
}

export class BgTestComputeStack extends cdk.Stack {
  public readonly ec2AsgAlb: elbv2.ApplicationLoadBalancer;
  public readonly ecsEc2Alb: elbv2.ApplicationLoadBalancer;
  public readonly ecsFgAlb: elbv2.ApplicationLoadBalancer;
  public readonly ec2AsgSecret: string;
  public readonly ecsEc2Secret: string;
  public readonly ecsFgSecret: string;

  private readonly color: Color;
  private readonly computeSubnets: ec2.ISubnet[];
  private readonly imageTag: string;
  private readonly imageUri: string;

  constructor(scope: Construct, id: string, props: BgTestComputeStackProps) {
    super(scope, id, props);
    this.color = props.color;
    this.imageTag = props.color;
    this.imageUri = `${props.ecrStack.repository.repositoryUri}:${this.imageTag}`;

    const subnets = props.computeSubnetGroup === 'private1'
      ? props.networkStack.private1Subnets
      : props.networkStack.private2Subnets;
    if (subnets.length === 0) {
      throw new Error(`No subnets available for group ${props.computeSubnetGroup}. Did you set includeSecondaryCidr=true?`);
    }
    this.computeSubnets = subnets;

    const vpc = props.networkStack.vpc;
    const ec2asgBundle = this.createAlbBundle('ec2asg', { tgPort: 80, tgType: elbv2.TargetType.INSTANCE, prefixListId: props.cloudFrontPrefixListId, vpc });
    const ecsec2Bundle = this.createAlbBundle('ecsec2', { tgPort: 80, tgType: elbv2.TargetType.INSTANCE, prefixListId: props.cloudFrontPrefixListId, vpc });
    const ecsfgBundle  = this.createAlbBundle('ecsfg',  { tgPort: LAB_CONFIG.compute.appPort, tgType: elbv2.TargetType.IP, prefixListId: props.cloudFrontPrefixListId, vpc });

    this.ec2AsgAlb = ec2asgBundle.alb;
    this.ecsEc2Alb = ecsec2Bundle.alb;
    this.ecsFgAlb  = ecsfgBundle.alb;
    this.ec2AsgSecret = ec2asgBundle.secret;
    this.ecsEc2Secret = ecsec2Bundle.secret;
    this.ecsFgSecret  = ecsfgBundle.secret;

    this.attachEc2Asg(ec2asgBundle, props);
    this.attachEcsEc2(ecsec2Bundle, props);
    this.attachEcsFargate(ecsfgBundle, props);

    new cdk.CfnOutput(this, 'Ec2AsgAlbDns', { value: this.ec2AsgAlb.loadBalancerDnsName, exportName: `BgTest-${props.color}-Ec2AsgAlb` });
    new cdk.CfnOutput(this, 'EcsEc2AlbDns', { value: this.ecsEc2Alb.loadBalancerDnsName, exportName: `BgTest-${props.color}-EcsEc2Alb` });
    new cdk.CfnOutput(this, 'EcsFgAlbDns',  { value: this.ecsFgAlb.loadBalancerDnsName,  exportName: `BgTest-${props.color}-EcsFgAlb` });
    new cdk.CfnOutput(this, 'Ec2AsgSecret', { value: this.ec2AsgSecret, exportName: `BgTest-${props.color}-Ec2AsgSecret` });
    new cdk.CfnOutput(this, 'EcsEc2Secret', { value: this.ecsEc2Secret, exportName: `BgTest-${props.color}-EcsEc2Secret` });
    new cdk.CfnOutput(this, 'EcsFgSecret',  { value: this.ecsFgSecret,  exportName: `BgTest-${props.color}-EcsFgSecret` });
  }

  private createAlbBundle(
    workload: string,
    opts: { tgPort: number; tgType: elbv2.TargetType; prefixListId: string; vpc: ec2.IVpc },
  ): AlbBundle {
    const albSg = new ec2.SecurityGroup(this, `${workload}AlbSg`, {
      vpc: opts.vpc,
      allowAllOutbound: true,
      securityGroupName: `bg-alb-${workload}-${this.color}-sg`,
      description: `ALB ${workload} ${this.color} SG`,
    });

    new ec2.CfnSecurityGroupIngress(this, `${workload}AlbIngress`, {
      groupId: albSg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 80,
      toPort: 80,
      sourcePrefixListId: opts.prefixListId,
      description: 'HTTP from CloudFront origin-facing only',
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, `${workload}Alb`, {
      vpc: opts.vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: `bg-alb-${workload}-${this.color}`.slice(0, 32),
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
    cdk.Tags.of(alb).add('Name', `bg-alb-${workload}-${this.color}`);

    const tg = new elbv2.ApplicationTargetGroup(this, `${workload}Tg`, {
      vpc: opts.vpc,
      port: opts.tgPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: opts.tgType,
      healthCheck: {
        path: '/health',
        port: opts.tgType === elbv2.TargetType.INSTANCE ? 'traffic-port' : String(opts.tgPort),
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
      },
    });

    const listener = alb.addListener(`${workload}Listener`, {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Access Denied',
      }),
    });

    const secret = `bg-${this.color}-${workload}-${this.account}-${cdk.Names.uniqueId(this).slice(-6)}`;
    listener.addAction(`${workload}Forward`, {
      priority: 1,
      conditions: [elbv2.ListenerCondition.httpHeader('X-Custom-Secret', [secret])],
      action: elbv2.ListenerAction.forward([tg]),
    });

    return { alb, listener, tg, secret };
  }

  private attachEc2Asg(bundle: AlbBundle, props: BgTestComputeStackProps) {
    const vpc = props.networkStack.vpc;

    const role = new iam.Role(this, 'Ec2AsgRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });
    props.dataStack.dbSecret.grantRead(role);

    const sg = new ec2.SecurityGroup(this, 'Ec2AsgSg', {
      vpc, allowAllOutbound: true,
      securityGroupName: `bg-ec2asg-${this.color}-sg`,
    });
    sg.addIngressRule(bundle.alb.connections.securityGroups[0], ec2.Port.tcp(80), 'ALB to instance');
    props.dataStack.dbSecurityGroup.addIngressRule(sg, ec2.Port.tcp(3306), 'EC2 ASG to Aurora', true);
    props.dataStack.redisSecurityGroup.addIngressRule(sg, ec2.Port.tcp(6379), 'EC2 ASG to Redis', true);

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      'dnf install -y docker',
      'systemctl enable --now docker',
      `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
      `DB_PASS=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id ${props.dataStack.dbSecret.secretArn} --query SecretString --output text | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')`,
      `docker run -d --restart=always --name app -p 80:${LAB_CONFIG.compute.appPort} \\`,
      `  -e COLOR=${this.color} \\`,
      '  -e COMPUTE_TYPE=ec2-asg \\',
      `  -e REDIS_URL=rediss://${props.dataStack.redisReplicationGroup.attrPrimaryEndPointAddress}:6379 \\`,
      `  -e DB_HOST=${props.dataStack.auroraCluster.clusterEndpoint.hostname} \\`,
      `  -e DB_USER=${LAB_CONFIG.data.dbUser} \\`,
      `  -e DB_NAME=${LAB_CONFIG.data.dbName} \\`,
      `  -e AWS_REGION=${this.region} \\`,
      '  -e DB_PASSWORD="$DB_PASS" \\',
      `  ${this.imageUri}`,
    );

    const lt = new ec2.LaunchTemplate(this, 'Ec2AsgLt', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.XLARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      role,
      securityGroup: sg,
      userData,
    });

    const asg = new autoscaling.AutoScalingGroup(this, 'Ec2Asg', {
      vpc, vpcSubnets: { subnets: this.computeSubnets },
      launchTemplate: lt,
      desiredCapacity: LAB_CONFIG.compute.asgDesired,
      minCapacity: LAB_CONFIG.compute.asgMin,
      maxCapacity: LAB_CONFIG.compute.asgMax,
      healthCheck: autoscaling.HealthCheck.elb({ grace: cdk.Duration.minutes(5) }),
      autoScalingGroupName: `bg-ec2asg-${this.color}`,
    });
    bundle.tg.addTarget(asg);
  }

  private attachEcsEc2(bundle: AlbBundle, props: BgTestComputeStackProps) {
    const vpc = props.networkStack.vpc;
    // Import the cluster locally with hasEc2Capacity=true so the Ec2Service
    // validation accepts it (the original cluster was created in another stack
    // and has _hasEc2Capacity=false; using the imported reference here also
    // avoids cross-stack cycles when associating capacity providers).
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'ImportedCluster', {
      clusterName: props.clusterStack.cluster.clusterName,
      clusterArn: props.clusterStack.cluster.clusterArn,
      vpc,
      securityGroups: [],
      hasEc2Capacity: true,
    });

    const hostRole = new iam.Role(this, 'EcsHostRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    const hostSg = new ec2.SecurityGroup(this, 'EcsHostSg', {
      vpc, allowAllOutbound: true, securityGroupName: `bg-ecsec2-host-${this.color}-sg`,
    });
    hostSg.addIngressRule(bundle.alb.connections.securityGroups[0], ec2.Port.tcpRange(32768, 65535), 'ALB to ECS host dynamic ports');
    props.dataStack.dbSecurityGroup.addIngressRule(hostSg, ec2.Port.tcp(3306), 'ECS-EC2 to Aurora', true);
    props.dataStack.redisSecurityGroup.addIngressRule(hostSg, ec2.Port.tcp(6379), 'ECS-EC2 to Redis', true);

    const hostUserData = ec2.UserData.forLinux();
    hostUserData.addCommands(`echo "ECS_CLUSTER=${cluster.clusterName}" >> /etc/ecs/ecs.config`);

    const hostLt = new ec2.LaunchTemplate(this, 'EcsHostLt', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.XLARGE),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(ecs.AmiHardwareType.ARM),
      role: hostRole,
      securityGroup: hostSg,
      userData: hostUserData,
    });

    const hostAsg = new autoscaling.AutoScalingGroup(this, 'EcsHostAsg', {
      vpc, vpcSubnets: { subnets: this.computeSubnets },
      launchTemplate: hostLt,
      desiredCapacity: LAB_CONFIG.compute.ecsHostAsgDesired,
      minCapacity: LAB_CONFIG.compute.ecsHostAsgMin,
      maxCapacity: LAB_CONFIG.compute.ecsHostAsgMax,
      autoScalingGroupName: `bg-ecsec2-host-${this.color}`,
    });

    const cp = new ecs.AsgCapacityProvider(this, 'EcsCp', {
      autoScalingGroup: hostAsg,
      capacityProviderName: `ec2-cp-${this.color}`,
      enableManagedTerminationProtection: false,
      enableManagedScaling: true,
      targetCapacityPercent: 100,
    });
    // Associate capacity provider with the cluster via CFN-level resource scoped
    // in this stack to avoid cross-stack cyclic dependencies that would arise
    // if `cluster.addAsgCapacityProvider(cp)` mutated the Cluster stack.
    new ecs.CfnClusterCapacityProviderAssociations(this, 'EcsCpAssoc', {
      cluster: cluster.clusterName,
      capacityProviders: [cp.capacityProviderName],
      defaultCapacityProviderStrategy: [
        { capacityProvider: cp.capacityProviderName, weight: 1 },
      ],
    });

    // Task role intentionally has no policies: the app communicates only with Aurora (TCP/3306)
    // and Redis (TCP/6379) via VPC, no AWS SDK calls from container runtime.
    const taskRole = new iam.Role(this, 'EcsEc2TaskRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    const execRole = new iam.Role(this, 'EcsEc2ExecRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
    });
    props.dataStack.dbSecret.grantRead(execRole);
    props.ecrStack.repository.grantPull(execRole);

    const td = new ecs.Ec2TaskDefinition(this, 'EcsEc2Td', {
      networkMode: ecs.NetworkMode.BRIDGE,
      taskRole, executionRole: execRole,
      family: `bg-ecsec2-${this.color}`,
    });
    const logs1 = new logs.LogGroup(this, 'EcsEc2Logs', { logGroupName: `/ecs/bg-ecsec2-${this.color}`, retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.DESTROY });
    const container = td.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(props.ecrStack.repository, this.imageTag),
      // 1 GiB per task allows ~14 tasks per t4g.xlarge (16 GiB) host while leaving headroom for ECS agent + system
      memoryLimitMiB: 1024,
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup: logs1 }),
      environment: this.appEnvironment(props, 'ecs-ec2'),
      secrets: { DB_PASSWORD: ecs.Secret.fromSecretsManager(props.dataStack.dbSecret, 'password') },
    });
    container.addPortMappings({ containerPort: LAB_CONFIG.compute.appPort, hostPort: 0, protocol: ecs.Protocol.TCP });

    const svc = new ecs.Ec2Service(this, 'EcsEc2Svc', {
      cluster, taskDefinition: td, desiredCount: 2,
      capacityProviderStrategies: [{ capacityProvider: cp.capacityProviderName, weight: 1 }],
      serviceName: `bg-ecsec2-${this.color}`,
    });
    bundle.tg.addTarget(svc.loadBalancerTarget({ containerName: 'app', containerPort: LAB_CONFIG.compute.appPort }));
  }

  private attachEcsFargate(bundle: AlbBundle, props: BgTestComputeStackProps) {
    const vpc = props.networkStack.vpc;
    const cluster = props.clusterStack.cluster;

    const sg = new ec2.SecurityGroup(this, 'EcsFgSg', {
      vpc, allowAllOutbound: true, securityGroupName: `bg-ecsfg-task-${this.color}-sg`,
    });
    sg.addIngressRule(bundle.alb.connections.securityGroups[0], ec2.Port.tcp(LAB_CONFIG.compute.appPort), 'ALB to Fargate task');
    props.dataStack.dbSecurityGroup.addIngressRule(sg, ec2.Port.tcp(3306), 'Fargate to Aurora', true);
    props.dataStack.redisSecurityGroup.addIngressRule(sg, ec2.Port.tcp(6379), 'Fargate to Redis', true);

    // Task role intentionally has no policies: the app communicates only with Aurora (TCP/3306)
    // and Redis (TCP/6379) via VPC, no AWS SDK calls from container runtime.
    const taskRole = new iam.Role(this, 'EcsFgTaskRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    const execRole = new iam.Role(this, 'EcsFgExecRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
    });
    props.dataStack.dbSecret.grantRead(execRole);
    props.ecrStack.repository.grantPull(execRole);

    const td = new ecs.FargateTaskDefinition(this, 'EcsFgTd', {
      cpu: LAB_CONFIG.compute.fargateCpu,
      memoryLimitMiB: LAB_CONFIG.compute.fargateMemory,
      taskRole, executionRole: execRole,
      family: `bg-ecsfg-${this.color}`,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    const logsFg = new logs.LogGroup(this, 'EcsFgLogs', { logGroupName: `/ecs/bg-ecsfg-${this.color}`, retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.DESTROY });
    const container = td.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(props.ecrStack.repository, this.imageTag),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup: logsFg }),
      environment: this.appEnvironment(props, 'ecs-fargate'),
      secrets: { DB_PASSWORD: ecs.Secret.fromSecretsManager(props.dataStack.dbSecret, 'password') },
    });
    container.addPortMappings({ containerPort: LAB_CONFIG.compute.appPort });

    const svc = new ecs.FargateService(this, 'EcsFgSvc', {
      cluster, taskDefinition: td, desiredCount: 2,
      capacityProviderStrategies: [{ capacityProvider: 'FARGATE', weight: 1 }],
      vpcSubnets: { subnets: this.computeSubnets },
      securityGroups: [sg],
      assignPublicIp: false,
      serviceName: `bg-ecsfg-${this.color}`,
    });
    svc.attachToApplicationTargetGroup(bundle.tg);
  }

  private appEnvironment(props: BgTestComputeStackProps, computeType: string): Record<string, string> {
    return {
      COLOR: this.color,
      COMPUTE_TYPE: computeType,
      REDIS_URL: `rediss://${props.dataStack.redisReplicationGroup.attrPrimaryEndPointAddress}:6379`,
      DB_HOST: props.dataStack.auroraCluster.clusterEndpoint.hostname,
      DB_USER: LAB_CONFIG.data.dbUser,
      DB_NAME: LAB_CONFIG.data.dbName,
      AWS_REGION: this.region,
    };
  }
}
