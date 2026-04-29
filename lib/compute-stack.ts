import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';
import { BgTestNetworkStack } from './network-stack';
import { BgTestDataStack } from './data-stack';
import { BgTestEcrStack } from './ecr-stack';
import { BgTestClusterStack } from './cluster-stack';
import { BgTestAlbStack } from './alb-stack';

export type Color = 'blue' | 'green';
export type ComputeSubnetGroup = 'private1' | 'private2';

export interface BgTestComputeStackProps extends cdk.StackProps {
  color: Color;
  computeSubnetGroup: ComputeSubnetGroup;
  networkStack: BgTestNetworkStack;
  dataStack: BgTestDataStack;
  ecrStack: BgTestEcrStack;
  clusterStack: BgTestClusterStack;
  albStack: BgTestAlbStack;
}

/**
 * Compute layer for one color (blue or green).
 *
 * Owns: EC2 ASG (with docker run), ECS host ASG, ECS-EC2 service, Fargate service.
 * Does NOT own: ALBs, Target Groups, Listener rules, Capacity Provider associations.
 *
 * Target groups are imported from BgTestAlbStack (TG↔LB association already in place).
 * No capacity provider strategy is used — ECS service falls back to launchType=EC2/FARGATE.
 * Color separation:
 *   - EC2 ASG / ECS host ASG: private-1 (Blue) vs private-2 (Green) subnets
 *   - ECS-EC2 task placement: placementConstraints (attribute:color == this.color)
 *   - ECS Fargate task placement: subnet selection (same as ASG)
 */
export class BgTestComputeStack extends cdk.Stack {
  public readonly capacityProviderName: string;
  private readonly color: Color;
  private readonly computeSubnets: ec2.ISubnet[];
  private readonly imageTag: string;
  private readonly imageUri: string;

  constructor(scope: Construct, id: string, props: BgTestComputeStackProps) {
    super(scope, id, props);
    this.color = props.color;
    this.imageTag = props.color;
    this.imageUri = `${props.ecrStack.repository.repositoryUri}:${this.imageTag}`;
    this.capacityProviderName = `ec2-cp-${this.color}`;

    const subnets = props.computeSubnetGroup === 'private1'
      ? props.networkStack.private1Subnets
      : props.networkStack.private2Subnets;
    if (subnets.length === 0) {
      throw new Error(`No subnets available for group ${props.computeSubnetGroup}. Did you set includeSecondaryCidr=true?`);
    }
    this.computeSubnets = subnets;

    // Pick this color's pre-created TGs from AlbStack
    const ec2AsgTg = this.color === 'blue' ? props.albStack.blueEc2AsgTg : props.albStack.greenEc2AsgTg!;
    const ecsEc2Tg = this.color === 'blue' ? props.albStack.blueEcsEc2Tg : props.albStack.greenEcsEc2Tg!;
    const ecsFgTg  = this.color === 'blue' ? props.albStack.blueEcsFgTg  : props.albStack.greenEcsFgTg!;

    if (!ec2AsgTg || !ecsEc2Tg || !ecsFgTg) {
      throw new Error(`AlbStack does not expose TGs for color=${this.color}. For Green, deploy AlbStack with includeGreen=true.`);
    }

    this.attachEc2Asg(props, ec2AsgTg);
    this.attachEcsEc2(props, ecsEc2Tg);
    this.attachEcsFargate(props, ecsFgTg);
  }

  private attachEc2Asg(props: BgTestComputeStackProps, tg: elbv2.IApplicationTargetGroup) {
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
      vpc, allowAllOutbound: true, securityGroupName: `bg-ec2asg-${this.color}-sg`,
    });
    sg.addIngressRule(ec2.Peer.ipv4(LAB_CONFIG.vpc.primaryCidr), ec2.Port.tcp(80), 'ALB to instance from primary VPC CIDR');
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
      instanceType: new ec2.InstanceType(LAB_CONFIG.compute.ec2InstanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      role, securityGroup: sg, userData,
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
    // Use raw CFn TargetGroupARNs property to avoid the L2 attachToApplicationTargetGroup
    // method, which adds a back-reference dep on the TG and would create a cross-stack
    // cycle (TG owned by AlbStack). With raw property, ASG → TG is unidirectional.
    const cfnAsg = asg.node.defaultChild as autoscaling.CfnAutoScalingGroup;
    cfnAsg.targetGroupArns = [tg.targetGroupArn];
  }

  private attachEcsEc2(props: BgTestComputeStackProps, tg: elbv2.IApplicationTargetGroup) {
    const vpc = props.networkStack.vpc;
    // No capacity provider strategy — ECS service uses launchType=EC2 (default when no CP).
    // Color separation via placement constraint: tasks only land on hosts with the matching attribute.
    // Import cluster locally with hasEc2Capacity=true so the Ec2Service validation passes
    // (the original cluster has _hasEc2Capacity=false because no addAsgCapacityProvider was called).
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
    hostSg.addIngressRule(ec2.Peer.ipv4(LAB_CONFIG.vpc.primaryCidr), ec2.Port.tcpRange(32768, 65535), 'ALB to ECS host dynamic ports (primary CIDR)');
    props.dataStack.dbSecurityGroup.addIngressRule(hostSg, ec2.Port.tcp(3306), 'ECS-EC2 to Aurora', true);
    props.dataStack.redisSecurityGroup.addIngressRule(hostSg, ec2.Port.tcp(6379), 'ECS-EC2 to Redis', true);

    const hostUserData = ec2.UserData.forLinux();
    hostUserData.addCommands(
      `echo "ECS_CLUSTER=${cluster.clusterName}" >> /etc/ecs/ecs.config`,
      `echo 'ECS_INSTANCE_ATTRIBUTES={"color":"${this.color}"}' >> /etc/ecs/ecs.config`,
    );

    const hostLt = new ec2.LaunchTemplate(this, 'EcsHostLt', {
      instanceType: new ec2.InstanceType(LAB_CONFIG.compute.ecsHostInstanceType),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(ecs.AmiHardwareType.ARM),
      role: hostRole, securityGroup: hostSg, userData: hostUserData,
    });

    new autoscaling.AutoScalingGroup(this, 'EcsHostAsg', {
      vpc, vpcSubnets: { subnets: this.computeSubnets },
      launchTemplate: hostLt,
      desiredCapacity: LAB_CONFIG.compute.ecsHostAsgDesired,
      minCapacity: LAB_CONFIG.compute.ecsHostAsgMin,
      maxCapacity: LAB_CONFIG.compute.ecsHostAsgMax,
      autoScalingGroupName: `bg-ecsec2-host-${this.color}`,
    });

    // Task role intentionally has no policies: app talks only TCP to Aurora/Redis, no AWS SDK calls.
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
    const logGroup = new logs.LogGroup(this, 'EcsEc2Logs', {
      logGroupName: `/ecs/bg-ecsec2-${this.color}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const container = td.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(props.ecrStack.repository, this.imageTag),
      memoryLimitMiB: 1024,
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup }),
      environment: this.appEnvironment(props, 'ecs-ec2'),
      secrets: { DB_PASSWORD: ecs.Secret.fromSecretsManager(props.dataStack.dbSecret, 'password') },
    });
    container.addPortMappings({ containerPort: LAB_CONFIG.compute.appPort, hostPort: 0, protocol: ecs.Protocol.TCP });

    const svc = new ecs.Ec2Service(this, 'EcsEc2Svc', {
      cluster, taskDefinition: td, desiredCount: 2,
      serviceName: `bg-ecsec2-${this.color}`,
      placementConstraints: [
        ecs.PlacementConstraint.memberOf(`attribute:color == ${this.color}`),
      ],
    });
    // Use raw CfnService.LoadBalancers (not L2 attachToApplicationTargetGroup) to keep
    // the Service → TG dep unidirectional (TG is owned by AlbStack; L2 method would
    // add a back-reference and create a cross-stack cycle).
    const cfnSvc = svc.node.defaultChild as ecs.CfnService;
    cfnSvc.loadBalancers = [{
      targetGroupArn: tg.targetGroupArn,
      containerName: 'app',
      containerPort: LAB_CONFIG.compute.appPort,
    }];
  }

  private attachEcsFargate(props: BgTestComputeStackProps, tg: elbv2.IApplicationTargetGroup) {
    const vpc = props.networkStack.vpc;
    const cluster = props.clusterStack.cluster;

    const sg = new ec2.SecurityGroup(this, 'EcsFgSg', {
      vpc, allowAllOutbound: true, securityGroupName: `bg-ecsfg-task-${this.color}-sg`,
    });
    sg.addIngressRule(ec2.Peer.ipv4(LAB_CONFIG.vpc.primaryCidr), ec2.Port.tcp(LAB_CONFIG.compute.appPort), 'ALB to Fargate task (primary CIDR)');
    props.dataStack.dbSecurityGroup.addIngressRule(sg, ec2.Port.tcp(3306), 'Fargate to Aurora', true);
    props.dataStack.redisSecurityGroup.addIngressRule(sg, ec2.Port.tcp(6379), 'Fargate to Redis', true);

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
    const logGroup = new logs.LogGroup(this, 'EcsFgLogs', {
      logGroupName: `/ecs/bg-ecsfg-${this.color}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const container = td.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(props.ecrStack.repository, this.imageTag),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup }),
      environment: this.appEnvironment(props, 'ecs-fargate'),
      secrets: { DB_PASSWORD: ecs.Secret.fromSecretsManager(props.dataStack.dbSecret, 'password') },
    });
    container.addPortMappings({ containerPort: LAB_CONFIG.compute.appPort });

    const svc = new ecs.FargateService(this, 'EcsFgSvc', {
      cluster, taskDefinition: td, desiredCount: 2,
      vpcSubnets: { subnets: this.computeSubnets },
      securityGroups: [sg],
      assignPublicIp: false,
      serviceName: `bg-ecsfg-${this.color}`,
    });
    const cfnSvc = svc.node.defaultChild as ecs.CfnService;
    cfnSvc.loadBalancers = [{
      targetGroupArn: tg.targetGroupArn,
      containerName: 'app',
      containerPort: LAB_CONFIG.compute.appPort,
    }];
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
