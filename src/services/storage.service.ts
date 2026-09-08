import { UserId } from "@/types/common.types";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

export const uploadAvatarToR2 = async (file: Express.Multer.File, userId: UserId): Promise<string> => {
    const extension = file.originalname.split(".").pop() || "jpg";
    const key = `avatars/user_${userId}_${Date.now()}.${extension}`;

    await r2Client.send(
        new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
        }),
    );

    return `${process.env.R2_PUBLIC_URL}/${key}`;
};

export const uploadCoverToR2 = async (file: Express.Multer.File, userId: UserId): Promise<string> => {
    const extension = file.originalname.split(".").pop() || "jpg";
    const key = `covers/user_${userId}_${Date.now()}.${extension}`;

    await r2Client.send(
        new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
        }),
    );

    return `${process.env.R2_PUBLIC_URL}/${key}`;
};

export const deleteFileFromR2 = async (fileUrl: string) => {
    try {
        const url = new URL(fileUrl);
        const fileKey = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;

        const command = new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: fileKey,
        });

        await r2Client.send(command);
    } catch (error) {
        console.error("R2 silme işlemi başarısız:", error);
    }
};
