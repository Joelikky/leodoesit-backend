const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
require('dotenv').config();

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

const uploadInvoiceToS3 = async (fileBuffer, fileName) => {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: `invoices/${fileName}`, 
        Body: fileBuffer,
        ContentType: 'application/pdf',
    };

    try {
        const command = new PutObjectCommand(params);
        await s3Client.send(command);
        return `invoices/${fileName}`; 
    } catch (error) {
        console.error("❌ S3 Upload Failed:", error.message);
        return null; 
    }
};

const generateSignedUrl = async (fileKey) => {
    try {
        const command = new GetObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: fileKey 
        });

        // Generate a URL that expires in 15 minutes (900 seconds)
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
        return signedUrl;

    } catch (error) {
        console.error("❌ Failed to generate Signed URL:", error.message);
        return null;
    }
};
// ... existing code (uploadInvoiceToS3, generateSignedUrl) ...

// 🔥 NEW: Uploads an image buffer directly to the S3 'timesheets' folder
const uploadTimesheetToS3 = async (fileBuffer, fileName, mimeType) => {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: `timesheets/${fileName}`,
        Body: fileBuffer,
        ContentType: mimeType,
    };

    try {
        const command = new PutObjectCommand(params);
        await s3Client.send(command);
        return `timesheets/${fileName}`; 
    } catch (error) {
        console.error("❌ S3 Image Upload Failed:", error.message);
        return null;
    }
};

// 🔥 CHANGED: Make sure all three functions are exported!
module.exports = { uploadInvoiceToS3, generateSignedUrl, uploadTimesheetToS3 };

