const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand
} = require("@aws-sdk/client-s3");

const {
    getSignedUrl
} = require("@aws-sdk/s3-request-presigner");

require('dotenv').config();

// ======================================================
// S3 CLIENT
// ======================================================

const s3Client = new S3Client({
    region: process.env.AWS_REGION,

    credentials: {
        accessKeyId:
            process.env.AWS_ACCESS_KEY_ID,

        secretAccessKey:
            process.env.AWS_SECRET_ACCESS_KEY,
    }
});

// ======================================================
// UPLOAD INVOICE PDF
// ======================================================

const uploadInvoiceToS3 = async (
    fileBuffer,
    fileName
) => {

    try {

        // IMPORTANT:
        // Save ONLY object key in DB
        const key = `invoices/${fileName}`;

        const params = {

            Bucket:
                process.env.AWS_S3_BUCKET_NAME,

            Key: key,

            Body: fileBuffer,

            ContentType: 'application/pdf',
        };

        const command =
            new PutObjectCommand(params);

        await s3Client.send(command);

        console.log(
            "✅ Invoice uploaded to S3:",
            key
        );

        // RETURN ONLY KEY
        return key;

    } catch (error) {

        console.error(
            "❌ S3 Upload Failed:",
            error
        );

        return null;
    }
};

// ======================================================
// GENERATE SECURE DOWNLOAD URL
// ======================================================

const generateSignedUrl = async (
    fileKey
) => {

    try {

        const command =
            new GetObjectCommand({

                Bucket:
                    process.env.AWS_S3_BUCKET_NAME,

                Key: fileKey
            });

        // URL valid for 15 mins
        const signedUrl =
            await getSignedUrl(
                s3Client,
                command,
                { expiresIn: 900 }
            );

        return signedUrl;

    } catch (error) {

        console.error(
            "❌ Failed to generate Signed URL:",
            error
        );

        return null;
    }
};

// ======================================================
// UPLOAD TIMESHEET IMAGE
// ======================================================

const uploadTimesheetToS3 = async (
    fileBuffer,
    fileName,
    mimeType
) => {

    try {

        const key =
            `timesheets/${fileName}`;

        const params = {

            Bucket:
                process.env.AWS_S3_BUCKET_NAME,

            Key: key,

            Body: fileBuffer,

            ContentType: mimeType,
        };

        const command =
            new PutObjectCommand(params);

        await s3Client.send(command);

        console.log(
            "✅ Timesheet uploaded:",
            key
        );

        return key;

    } catch (error) {

        console.error(
            "❌ Timesheet Upload Failed:",
            error
        );

        return null;
    }
};

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
    uploadInvoiceToS3,
    generateSignedUrl,
    uploadTimesheetToS3
};