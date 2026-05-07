const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/live-posters');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const extension = path.extname(file.originalname || '').toLowerCase();
    const baseName = path.basename(file.originalname || 'live-image', extension)
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'live-image';
    cb(null, `${baseName}-${uniqueSuffix}${extension}`);
  },
});

const allowedMimes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
]);

const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const fileFilter = (_req, file, cb) => {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (allowedMimes.has(file.mimetype) || allowedExtensions.has(extension)) {
    cb(null, true);
    return;
  }

  cb(new Error('Invalid file type. Allowed: JPG, JPEG, PNG, WEBP'), false);
};

module.exports = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});
