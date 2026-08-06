# AWS Infrastructure

Terraform configurations for AWS deployment.

## Structure (to be created)

```
aws/
├── terraform/
│   ├── modules/
│   │   ├── vpc/
│   │   ├── ecs/
│   │   ├── rds/
│   │   ├── elasticache/
│   │   └── s3/
│   ├── environments/
│   │   ├── dev/
│   │   ├── staging/
│   │   └── prod/
│   └── main.tf
└── cloudformation/
    └── templates/
```

## Resources

- VPC with public/private subnets
- ECS Fargate cluster
- Application Load Balancer
- DocumentDB (MongoDB-compatible)
- ElastiCache Redis
- S3 buckets
- CloudFront CDN
- Route53 DNS
- ACM certificates
- CloudWatch Logs & Metrics
- Secrets Manager

## Deployment

```bash
cd terraform/environments/prod
terraform init
terraform plan
terraform apply
```
