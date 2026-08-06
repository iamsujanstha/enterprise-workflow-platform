#!/bin/bash

set -e

ENV=${1:-dev}
AWS_REGION=${AWS_REGION:-us-east-1}
ECR_REPO="enterprise-workflow-platform"

echo "🚀 Deploying to $ENV environment..."

# Build Docker images
echo "📦 Building Docker images..."
docker build -t $ECR_REPO/backend:latest -f ../docker/Dockerfile.backend ../../apps/backend
docker build -t $ECR_REPO/frontend:latest -f ../docker/Dockerfile.frontend ../../apps/frontend

# Login to ECR
echo "🔐 Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com

# Tag and push images
echo "⬆️  Pushing images to ECR..."
docker tag $ECR_REPO/backend:latest $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO/backend:latest
docker tag $ECR_REPO/frontend:latest $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO/frontend:latest

docker push $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO/backend:latest
docker push $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO/frontend:latest

# Update ECS service
echo "🔄 Updating ECS service..."
aws ecs update-service --cluster $ENV-cluster --service backend-service --force-new-deployment --region $AWS_REGION
aws ecs update-service --cluster $ENV-cluster --service frontend-service --force-new-deployment --region $AWS_REGION

echo "✅ Deployment complete!"
