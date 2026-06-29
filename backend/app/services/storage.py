import os
import uuid
from fastapi import UploadFile, HTTPException
import boto3
from botocore.config import Config


def _r2_client_and_targets():
    """Build a boto3 S3 client for Cloudflare R2 and return it with the bucket name
    and public base URL. Raises HTTP 500 if any credential is missing."""
    account_id = os.getenv("CF_R2_ACCOUNT_ID")
    access_key = os.getenv("CF_R2_ACCESS_KEY_ID")
    secret_key = os.getenv("CF_R2_SECRET_ACCESS_KEY")
    bucket_name = os.getenv("CF_R2_BUCKET_NAME")
    public_url = os.getenv("CF_R2_PUBLIC_URL")

    if not all([account_id, access_key, secret_key, bucket_name, public_url]):
        raise HTTPException(
            status_code=500,
            detail="Cloudflare R2 storage credentials are not properly configured in backend/.env."
        )

    s3_client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto"
    )
    return s3_client, bucket_name, public_url.rstrip("/")


def upload_video_to_r2(file: UploadFile) -> str:
    s3_client, bucket_name, base_url = _r2_client_and_targets()

    file_ext = os.path.splitext(file.filename)[1]
    unique_filename = f"modules/{uuid.uuid4()}{file_ext}"

    try:
        content_type = file.content_type or "video/mp4"

        # Reset file cursor just in case it has been read before
        file.file.seek(0)

        s3_client.put_object(
            Bucket=bucket_name,
            Key=unique_filename,
            Body=file.file,
            ContentType=content_type
        )

        return f"{base_url}/{unique_filename}"

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload video to Cloudflare R2: {str(exc)}"
        )


def upload_recording_to_r2(file: UploadFile, prefix: str = "interviews") -> str:
    """Upload a full interview screen+audio recording to R2 and return its public URL.

    Mirrors upload_video_to_r2 but stores under a separate key prefix so module
    videos and interview recordings never collide.
    """
    s3_client, bucket_name, base_url = _r2_client_and_targets()

    file_ext = os.path.splitext(file.filename or "")[1] or ".webm"
    unique_filename = f"{prefix}/{uuid.uuid4()}{file_ext}"

    try:
        content_type = file.content_type or "video/webm"

        file.file.seek(0)

        s3_client.put_object(
            Bucket=bucket_name,
            Key=unique_filename,
            Body=file.file,
            ContentType=content_type
        )

        return f"{base_url}/{unique_filename}"

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload interview recording to Cloudflare R2: {str(exc)}"
        )
