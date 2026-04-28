import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';

export interface BgTestNetworkStackProps extends cdk.StackProps {
  includeSecondaryCidr: boolean;
}

export class BgTestNetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly private1Subnets: ec2.ISubnet[];
  public readonly private2Subnets: ec2.ISubnet[];
  public readonly private3Subnets: ec2.ISubnet[];
  public readonly dbSubnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props: BgTestNetworkStackProps) {
    super(scope, id, props);

    const tags = commonTags();
    const cfg = LAB_CONFIG.vpc;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(cfg.primaryCidr),
      maxAzs: 2,
      natGateways: 2,
      subnetConfiguration: [
        { name: 'public',   subnetType: ec2.SubnetType.PUBLIC,             cidrMask: 24 },
        { name: 'private1', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'private3', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'db',       subnetType: ec2.SubnetType.PRIVATE_ISOLATED,    cidrMask: 24 },
      ],
    });
    cdk.Tags.of(this.vpc).add('Name', cfg.name);
    Object.entries(tags).forEach(([k, v]) => cdk.Tags.of(this.vpc).add(k, v));

    this.publicSubnets   = this.vpc.selectSubnets({ subnetGroupName: 'public' }).subnets;
    this.private1Subnets = this.vpc.selectSubnets({ subnetGroupName: 'private1' }).subnets;
    this.private3Subnets = this.vpc.selectSubnets({ subnetGroupName: 'private3' }).subnets;
    this.dbSubnets       = this.vpc.selectSubnets({ subnetGroupName: 'db' }).subnets;
    this.private2Subnets = props.includeSecondaryCidr
      ? this.buildSecondaryCidrSubnets()
      : [];

    this.addVpcEndpoints();
  }

  private buildSecondaryCidrSubnets(): ec2.ISubnet[] {
    const cfg = LAB_CONFIG.vpc;
    const cidrAssoc = new ec2.CfnVPCCidrBlock(this, 'SecondaryCidr', {
      vpcId: this.vpc.vpcId,
      cidrBlock: cfg.secondaryCidr,
    });

    const azs = cdk.Stack.of(this).availabilityZones.slice(0, 2);
    const newSubnets: ec2.ISubnet[] = [];
    azs.forEach((az, i) => {
      const subnet = new ec2.Subnet(this, `Private2Subnet${i}`, {
        vpcId: this.vpc.vpcId,
        availabilityZone: az,
        cidrBlock: i === 0 ? cfg.subnets.private2.cidrA : cfg.subnets.private2.cidrB,
        mapPublicIpOnLaunch: false,
      });
      subnet.node.addDependency(cidrAssoc);
      cdk.Tags.of(subnet).add('Name', `bg-private2-${az.slice(-1)}`);

      const natGw = this.vpc.publicSubnets[i].node.tryFindChild('NATGateway') as ec2.CfnNatGateway | undefined;
      if (natGw) {
        new ec2.CfnRoute(this, `Private2Route${i}`, {
          routeTableId: subnet.routeTable.routeTableId,
          destinationCidrBlock: '0.0.0.0/0',
          natGatewayId: natGw.ref,
        });
      } else {
        cdk.Annotations.of(this).addWarning(
          `Could not locate NAT gateway in public subnet [${i}]; private2 subnet will lack internet egress. ` +
          `This may indicate a CDK version change to internal NAT GW construct id.`,
        );
      }
      newSubnets.push(subnet);
    });
    return newSubnets;
  }

  private addVpcEndpoints() {
    const subnetSelection: ec2.SubnetSelection = {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    };

    new ec2.GatewayVpcEndpoint(this, 'S3Endpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    const interfaceServices: { id: string; svc: ec2.InterfaceVpcEndpointAwsService }[] = [
      { id: 'EcrApi',      svc: ec2.InterfaceVpcEndpointAwsService.ECR },
      { id: 'EcrDkr',      svc: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER },
      { id: 'CwLogs',      svc: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS },
      { id: 'Secrets',     svc: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER },
      { id: 'Ssm',         svc: ec2.InterfaceVpcEndpointAwsService.SSM },
      { id: 'SsmMessages', svc: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES },
      { id: 'Ec2Messages', svc: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES },
    ];

    for (const { id, svc } of interfaceServices) {
      new ec2.InterfaceVpcEndpoint(this, `${id}Endpoint`, {
        vpc: this.vpc,
        service: svc,
        subnets: subnetSelection,
        privateDnsEnabled: true,
      });
    }
  }
}
