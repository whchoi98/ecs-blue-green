import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';

export class BgTestEcrStack extends cdk.Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.repository = new ecr.Repository(this, 'Repo', {
      repositoryName: LAB_CONFIG.ecrRepoName,
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [{
        description: 'Keep last 10 images',
        maxImageCount: 10,
        rulePriority: 1,
      }],
    });

    Object.entries(commonTags()).forEach(([k, v]) => cdk.Tags.of(this.repository).add(k, v));
    cdk.Tags.of(this.repository).add('Name', 'bg-ecr');

    new cdk.CfnOutput(this, 'RepoUri', {
      value: this.repository.repositoryUri,
      exportName: 'BgTestEcrUri',
    });
  }
}
