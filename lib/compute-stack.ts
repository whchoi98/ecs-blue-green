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
  /**
   * Whether this stack creates the ALBs and listener rules.
   * Blue stack: true (creates 3 ALBs + weighted listener rules pointing to its TGs and optionally peer's TGs)
   * Green stack: false (creates only TGs/ASGs/services; reuses Blue's ALBs via shared listener rule)
   */
  manageAlb?: boolean;
  /**
   * Whether this stack creates the cluster's CapacityProviderAssociations.
   * Only one stack per cluster may own this resource. Blue=true, Green=false.
   */
  manageClusterAssociation?: boolean;
  /**
   * Optional peer compute stack whose target groups should be added to this stack's
   * weighted listener rules. Used by Blue to receive Green's target groups so weight
   * can be shifted between Blue and Green via ALB weighted forwarding.
   */
  peerStack?: BgTestComputeStack;
}

export class BgTestComputeStack extends cdk.Stack {
  public readonly ec2AsgTg: elbv2.ApplicationTargetGroup;
  public readonly ecsEc2Tg: elbv2.ApplicationTargetGroup;
  public readonly ecsFgTg: elbv2.ApplicationTargetGroup;
  public readonly capacityProviderName: string;

  // Optional — only set when manageAlb=true
  public readonly ec2AsgAlb?: elbv2.ApplicationLoadBalancer;
  public readonly ecsEc2Alb?: elbv2.ApplicationLoadBalancer;
  public readonly ecsFgAlb?: elbv2.ApplicationLoadBalancer;
  public readonly ec2AsgSecret?: string;
  public readonly ecsEc2Secret?: string;
  public readonly ecsFgSecret?: string;

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
    const manageAlb = props.manageAlb ?? true;
    const manageAssoc = props.manageClusterAssociation ?? true;

    // 1) Always create target groups (whether or not we own the ALB)
    this.ec2AsgTg = this.createTargetGroup('ec2asg', { vpc, port: 80, type: elbv2.TargetType.INSTANCE });
    this.ecsEc2Tg = this.createTargetGroup('ecsec2', { vpc, port: 80, type: elbv2.TargetType.INSTANCE });
    this.ecsFgTg  = this.createTargetGroup('ecsfg',  { vpc, port: LAB_CONFIG.compute.appPort, type: elbv2.TargetType.IP });

    // 2) Optionally create ALBs + listeners + weighted forward rules
    if (manageAlb) {
      const ec2asgAlb = this.createAlbWithListener('ec2asg', { vpc, prefixListId: props.cloudFrontPrefixListId, primaryTg: this.ec2AsgTg, peerTg: props.peerStack?.ec2AsgTg });
      const ecsec2Alb = this.createAlbWithListener('ecsec2', { vpc, prefixListId: props.cloudFrontPrefixListId, primaryTg: this.ecsEc2Tg, peerTg: props.peerStack?.ecsEc2Tg });
      const ecsfgAlb  = this.createAlbWithListener('ecsfg',  { vpc, prefixListId: props.cloudFrontPrefixListId, primaryTg: this.ecsFgTg,  peerTg: props.peerStack?.ecsFgTg });

      (this as any).ec2AsgAlb = ec2asgAlb.alb;
      (this as any).ecsEc2Alb = ecsec2Alb.alb;
      (this as any).ecsFgAlb  = ecsfgAlb.alb;
      (this as any).ec2AsgSecret = ec2asgAlb.secret;
      (this as any).ecsEc2Secret = ecsec2Alb.secret;
      (this as any).ecsFgSecret  = ecsfgAlb.secret;

      new cdk.CfnOutput(this, 'Ec2AsgAlbDns', { value: ec2asgAlb.alb.loadBalancerDnsName, exportName: `BgTest-${props.color}-Ec2AsgAlb` });
      new cdk.CfnOutput(this, 'EcsEc2AlbDns', { value: ecsec2Alb.alb.loadBalancerDnsName, exportName: `BgTest-${props.color}-EcsEc2Alb` });
      new cdk.CfnOutput(this, 'EcsFgAlbDns',  { value: ecsfgAlb.alb.loadBalancerDnsName,  exportName: `BgTest-${props.color}-EcsFgAlb` });
      new cdk.CfnOutput(this, 'Ec2AsgSecret', { value: ec2asgAlb.secret, exportName: `BgTest-${props.color}-Ec2AsgSecret` });
      new cdk.CfnOutput(this, 'EcsEc2Secret', { value: ecsec2Alb.secret, exportName: `BgTest-${props.color}-EcsEc2Secret` });
      new cdk.CfnOutput(this, 'EcsFgSecret',  { value: ecsfgAlb.secret,  exportName: `BgTest-${props.color}-EcsFgSecret` });
    }

    // 3) Compute (EC2 ASG + ECS-EC2 + Fargate) — register to TGs (work the same regardless of manageAlb)
    this.attachEc2Asg(props);
    this.capacityProviderName = `ec2-cp-${this.color}`;
    this.attachEcsEc2(props, manageAssoc);
    this.attachEcsFargate(props);

    new cdk.CfnOutput(this, 'Ec2AsgTgArn', { value: this.ec2AsgTg.targetGroupArn, exportName: `BgTest-${props.color}-Ec2AsgTgArn` });
    new cdk.CfnOutput(this, 'EcsEc2TgArn', { value: this.ecsEc2Tg.targetGroupArn, exportName: `BgTest-${props.color}-EcsEc2TgArn` });
    new cdk.CfnOutput(this, 'EcsFgTgArn',  { value: this.ecsFgTg.targetGroupArn,  exportName: `BgTest-${props.color}-EcsFgTgArn` });
  }

  private createTargetGroup(workload: string, opts: { vpc: ec2.IVpc; port: number; type: elbv2.TargetType }): elbv2.ApplicationTargetGroup {
    const tg = new elbv2.ApplicationTargetGroup(this, `${workload}Tg`, {
      vpc: opts.vpc,
      port: opts.port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: opts.type,
      targetGroupName: `bg-tg-${workload}-${this.color}`.slice(0, 32),
      healthCheck: {
        path: '/health',
        port: opts.type === elbv2.TargetType.INSTANCE ? 'traffic-port' : String(opts.port),
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
      },
    });
    cdk.Tags.of(tg).add('Name', `bg-tg-${workload}-${this.color}`);
    cdk.Tags.of(tg).add('Color', this.color);
    return tg;
  }

  private createAlbWithListener(
    workload: string,
    opts: { vpc: ec2.IVpc; prefixListId: string; primaryTg: elbv2.IApplicationTargetGroup; peerTg?: elbv2.IApplicationTargetGroup },
  ): { alb: elbv2.ApplicationLoadBalancer; listener: elbv2.ApplicationListener; secret: string } {
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
    Object.entries(commonTags()).forEach(([k, v]) => cdk.Tags.of(alb).add(k, v));

    const listener = alb.addListener(`${workload}Listener`, {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Access Denied',
      }),
    });

    const secret = `bg-${this.color}-${workload}-${this.account}-${cdk.Names.uniqueId(this).slice(-6)}`;
    // Use L1 CfnListenerRule (instead of listener.addAction) to avoid CDK's automatic
    // service↔listener-rule dependency. The auto-dep would cause a cross-stack cycle:
    //   Blue rule references Green TG → Blue Stack depends on Green Stack
    //   Green Service auto-deps on listener rule referencing its TG → Green Stack depends on Blue Stack
    // L1 rule only references TG ARNs (strings) — no service-level dep is added.
    const ruleTargetGroups = [
      { targetGroupArn: opts.primaryTg.targetGroupArn, weight: 100 },
    ];
    if (opts.peerTg) {
      ruleTargetGroups.push({ targetGroupArn: opts.peerTg.targetGroupArn, weight: 0 });
    }
    new elbv2.CfnListenerRule(this, `${workload}ForwardRule`, {
      listenerArn: listener.listenerArn,
      priority: 1,
      conditions: [{
        field: 'http-header',
        httpHeaderConfig: {
          httpHeaderName: 'X-Custom-Secret',
          values: [secret],
        },
      }],
      actions: [{
        type: 'forward',
        forwardConfig: {
          targetGroups: ruleTargetGroups,
        },
      }],
    });

    return { alb, listener, secret };
  }

  private attachEc2Asg(props: BgTestComputeStackProps) {
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
    // Accept ALB traffic from anywhere within the VPC (Blue ALB is in public subnet, primary CIDR;
    // secondary CIDR may host another ALB later). Both VPC CIDRs are trusted (lab environment).
    sg.addIngressRule(ec2.Peer.ipv4(LAB_CONFIG.vpc.primaryCidr), ec2.Port.tcp(80), 'ALB → instance from primary VPC CIDR');
    sg.addIngressRule(ec2.Peer.ipv4(LAB_CONFIG.vpc.secondaryCidr), ec2.Port.tcp(80), 'ALB → instance from secondary VPC CIDR');
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
    this.ec2AsgTg.addTarget(asg);
  }

  private attachEcsEc2(props: BgTestComputeStackProps, manageAssoc: boolean) {
    const vpc = props.networkStack.vpc;
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
    hostSg.addIngressRule(ec2.Peer.ipv4(LAB_CONFIG.vpc.primaryCidr), ec2.Port.tcpRange(32768, 65535), 'ALB → ECS host dynamic ports (primary CIDR)');
    hostSg.addIngressRule(ec2.Peer.ipv4(LAB_CONFIG.vpc.secondaryCidr), ec2.Port.tcpRange(32768, 65535), 'ALB → ECS host dynamic ports (secondary CIDR)');
    props.dataStack.dbSecurityGroup.addIngressRule(hostSg, ec2.Port.tcp(3306), 'ECS-EC2 to Aurora', true);
    props.dataStack.redisSecurityGroup.addIngressRule(hostSg, ec2.Port.tcp(6379), 'ECS-EC2 to Redis', true);

    const hostUserData = ec2.UserData.forLinux();
    hostUserData.addCommands(`echo "ECS_CLUSTER=${cluster.clusterName}" >> /etc/ecs/ecs.config`);

    const hostLt = new ec2.LaunchTemplate(this, 'EcsHostLt', {
      instanceType: new ec2.InstanceType(LAB_CONFIG.compute.ecsHostInstanceType),
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

    if (manageAssoc) {
      // Cluster's CapacityProviderAssociations is unique per-cluster: only Blue creates it.
      // Blue's list always includes its own EC2 CP + FARGATE + FARGATE_SPOT, plus Green's CP
      // when peerStack is set so Green's services can use ec2-cp-green.
      const cps = [cp.capacityProviderName, 'FARGATE', 'FARGATE_SPOT'];
      if (props.peerStack) {
        cps.push(props.peerStack.capacityProviderName);
      }
      new ecs.CfnClusterCapacityProviderAssociations(this, 'EcsCpAssoc', {
        cluster: cluster.clusterName,
        capacityProviders: cps,
        defaultCapacityProviderStrategy: [
          { capacityProvider: cp.capacityProviderName, weight: 1 },
        ],
      });
    }

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
    this.ecsEc2Tg.addTarget(svc.loadBalancerTarget({ containerName: 'app', containerPort: LAB_CONFIG.compute.appPort }));
  }

  private attachEcsFargate(props: BgTestComputeStackProps) {
    const vpc = props.networkStack.vpc;
    const cluster = props.clusterStack.cluster;

    const sg = new ec2.SecurityGroup(this, 'EcsFgSg', {
      vpc, allowAllOutbound: true, securityGroupName: `bg-ecsfg-task-${this.color}-sg`,
    });
    sg.addIngressRule(ec2.Peer.ipv4(LAB_CONFIG.vpc.primaryCidr), ec2.Port.tcp(LAB_CONFIG.compute.appPort), 'ALB → Fargate task (primary CIDR)');
    sg.addIngressRule(ec2.Peer.ipv4(LAB_CONFIG.vpc.secondaryCidr), ec2.Port.tcp(LAB_CONFIG.compute.appPort), 'ALB → Fargate task (secondary CIDR)');
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
    svc.attachToApplicationTargetGroup(this.ecsFgTg);
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
