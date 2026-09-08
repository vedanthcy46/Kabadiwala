import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import { ApiError } from '../utils/ApiError.js';

dotenv.config();

const MAX_DATA_URL_BYTES = 6 * 1024 * 1024;

const isDataImage = (value) => typeof value === 'string' && /^data:image\/[a-zA-Z0-9.+_-]+;base64,/i.test(value);

const cloudinaryReady = () => Boolean(
  process.env.CLOUDINARY_CLOUD_NAME
  && process.env.CLOUDINARY_API_KEY
  && process.env.CLOUDINARY_API_SECRET
);

/**
 * Upload any data image to Cloudinary and return its secure HTTPS URL.
 * @param {string} image - Base64 data URL or existing HTTPS URL
 * @param {Object} opts
 * @param {string} opts.folder - Cloudinary target folder
 * @param {string} opts.publicId - Public ID for the uploaded asset
 * @returns {Promise<string|null>}
 */
export const uploadImage = async (image, { folder = 'kabadiwala/uploads', publicId = `img-${Date.now()}` } = {}) => {
  if (!image) return null;
  // If already a hosted URL (e.g. Cloudinary HTTPS), return as-is
  if (!isDataImage(image)) return image;

  if (Buffer.byteLength(image, 'utf8') > MAX_DATA_URL_BYTES) {
    throw new ApiError(413, 'Image is too large. Please choose a photo under 6 MB.');
  }
  if (!cloudinaryReady()) {
    console.warn('[cloudinary] Storage not configured. Image not uploaded.');
    return null;
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  try {
    const result = await cloudinary.uploader.upload(image, {
      folder,
      public_id: publicId,
      resource_type: 'image',
      overwrite: false,
      unique_filename: true,
      transformation: [{ quality: 'auto:good', fetch_format: 'auto' }],
    });
    return result.secure_url;
  } catch (err) {
    console.error(`[cloudinary] Upload failed (${err.message}).`);
    return null;
  }
};

/**
 * Upload a client-compressed image to Cloudinary and return its durable HTTPS
 * URL. The database deliberately receives this URL only, never the base64
 * image payload or Cloudinary credentials.
 */
export const uploadLotImage = async (image, { lotId, imageType }) => {
  return uploadImage(image, {
    folder: `kabadiwala/lots/${lotId}`,
    publicId: `${imageType.toLowerCase()}-${Date.now()}`,
  });
};
