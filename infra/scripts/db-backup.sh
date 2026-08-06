#!/bin/bash

set -e

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"
S3_BUCKET="s3://enterprise-workflow-backups"
MONGO_URI=${MONGO_URI:-"mongodb://localhost:27017/enterprise-workflow"}

echo "📦 Starting database backup..."

# Create backup directory
mkdir -p $BACKUP_DIR

# Dump MongoDB
echo "💾 Dumping MongoDB..."
mongodump --uri="$MONGO_URI" --out="$BACKUP_DIR/mongo_$DATE"

# Compress
echo "🗜️  Compressing backup..."
tar -czf "$BACKUP_DIR/mongo_$DATE.tar.gz" -C "$BACKUP_DIR" "mongo_$DATE"
rm -rf "$BACKUP_DIR/mongo_$DATE"

# Upload to S3
echo "⬆️  Uploading to S3..."
aws s3 cp "$BACKUP_DIR/mongo_$DATE.tar.gz" "$S3_BUCKET/mongo_$DATE.tar.gz"

# Cleanup local backup (keep last 3 days)
echo "🧹 Cleaning up old local backups..."
find $BACKUP_DIR -name "mongo_*.tar.gz" -mtime +3 -delete

# Cleanup S3 (keep last 30 days)
echo "🧹 Cleaning up old S3 backups..."
aws s3 ls $S3_BUCKET/ | grep mongo_ | awk '{print $4}' | while read file; do
    file_date=$(echo $file | grep -oP '\d{8}')
    days_old=$(( ($(date +%s) - $(date -d $file_date +%s)) / 86400 ))
    if [ $days_old -gt 30 ]; then
        aws s3 rm "$S3_BUCKET/$file"
    fi
done

echo "✅ Backup complete: mongo_$DATE.tar.gz"
