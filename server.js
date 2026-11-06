const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const express = require('express');
const multer = require('multer');

const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;

const ALLOWED_EXTENSIONS = new Set([
  '.wav',
  '.webm',
  '.ogg',
  '.mp3',
  '.m4a',
  '.aac',
  '.flac',
]);

const ALLOWED_MIME_TYPES = new Set([
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'application/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/x-aac',
  'audio/flac',
  'audio/x-flac',
]);

const MIME_TO_EXTENSION = {
  'audio/wav': '.wav',
  'audio/wave': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'application/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/m4a': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/x-aac': '.aac',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
};

function getEnv(env, key) {
  if (!env || env[key] == null) return '';
  return String(env[key]).trim();
}

function getBindHost(env = process.env) {
  return getEnv(env, 'AUDIEAUX_HOST') || getEnv(env, 'HOST') || DEFAULT_HOST;
}

function getBindPort(env = process.env) {
  const raw = getEnv(env, 'PORT');
  if (!raw) return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_PORT;
}

function getMaxUploadBytes(env = process.env) {
  const raw = getEnv(env, 'AUDIEAUX_MAX_UPLOAD_BYTES');
  if (!raw) return DEFAULT_MAX_UPLOAD_BYTES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_BYTES;
}

function getUploadToken(env = process.env) {
  return getEnv(env, 'AUDIEAUX_UPLOAD_TOKEN');
}

function isLoopbackHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized === '::ffff:127.0.0.1'
  );
}

function assertSafeToListen(env = process.env) {
  const host = getBindHost(env);
  const token = getUploadToken(env);
  if (!isLoopbackHost(host) && !token) {
    const error = new Error(
      `Refusing to bind to non-loopback host ${host} without AUDIEAUX_UPLOAD_TOKEN`
    );
    error.code = 'AUDIEAUX_BIND_REFUSED';
    throw error;
  }
  return host;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    if (left.length > 0) crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function extractProvidedToken(req) {
  const header = String(req.get('authorization') || '').trim();
  const bearer = /^Bearer\s+(\S+)/i.exec(header);
  if (bearer) return bearer[1];
  const alt = req.get('x-upload-token');
  return alt ? String(alt).trim() : '';
}

function ascii(buffer, start, length) {
  return buffer.subarray(start, start + length).toString('ascii');
}

function sniffAudioExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  if (buffer.length >= 12 && ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WAVE') {
    return '.wav';
  }
  if (ascii(buffer, 0, 4) === 'OggS') return '.ogg';
  if (ascii(buffer, 0, 4) === 'fLaC') return '.flac';
  if (ascii(buffer, 0, 3) === 'ID3') return '.mp3';
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return '.webm';
  }
  if (buffer.length >= 8 && ascii(buffer, 4, 4) === 'ftyp') return '.m4a';
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return '.aac';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return '.mp3';
  return null;
}

function clientExtension(originalname) {
  const base = path.basename(String(originalname || ''));
  const ext = path.extname(base).toLowerCase();
  return ext || '';
}

function resolveSafeUploadPath(uploadsDir, filename) {
  const root = path.resolve(uploadsDir);
  const target = path.resolve(root, filename);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(prefix)) {
    const error = new Error('Invalid upload path');
    error.status = 400;
    throw error;
  }
  return target;
}

function validateUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    const error = new Error('No audio file uploaded');
    error.status = 400;
    throw error;
  }

  const mime = String(file.mimetype || '').toLowerCase();
  const ext = clientExtension(file.originalname);
  const sniffed = sniffAudioExtension(file.buffer);

  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    const error = new Error('Unsupported media type');
    error.status = 415;
    throw error;
  }
  if (mime && !ALLOWED_MIME_TYPES.has(mime)) {
    const error = new Error('Unsupported media type');
    error.status = 415;
    throw error;
  }
  if (!sniffed) {
    const error = new Error('Unsupported media type');
    error.status = 415;
    throw error;
  }
  if (ext && ext !== sniffed) {
    const error = new Error('Unsupported media type');
    error.status = 415;
    throw error;
  }

  return sniffed || MIME_TO_EXTENSION[mime] || '.wav';
}

function securityHeaders(_req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'none'");
  next();
}

function createApp(options = {}) {
  const env = options.env || process.env;
  const uploadsDir = options.uploadsDir || path.join(__dirname, 'uploads');
  const maxUploadBytes = options.maxUploadBytes || getMaxUploadBytes(env);
  const expectedToken = options.token != null ? String(options.token) : getUploadToken(env);

  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o700 });

  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use('/uploads', (_req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });
  app.use(express.static(path.join(__dirname, 'public')));

  function requireUploadAuth(req, res, next) {
    if (!expectedToken) return next();
    const provided = extractProvidedToken(req);
    if (!provided || !safeEqual(provided, expectedToken)) {
      res.set('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    return next();
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxUploadBytes,
      files: 1,
      fields: 5,
    },
  });

  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'record.html'));
  });

  app.post('/upload', requireUploadAuth, (req, res, next) => {
    upload.single('audio')(req, res, (err) => {
      if (err) return next(err);

      try {
        const extension = validateUpload(req.file);
        const filename = `${crypto.randomUUID()}${extension}`;
        const destination = resolveSafeUploadPath(uploadsDir, filename);
        fs.writeFileSync(destination, req.file.buffer, { flag: 'wx', mode: 0o600 });
        return res.json({
          success: true,
          message: 'Audio file saved successfully',
        });
      } catch (error) {
        return next(error);
      }
    });
  });

  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, error: 'File too large' });
      }
      return res.status(400).json({ success: false, error: 'Invalid upload' });
    }
    const status = Number(err && err.status) || 500;
    if (status >= 500) {
      console.error('Upload server error:', err);
    }
    return res.status(status).json({
      success: false,
      error: status >= 500 ? 'Internal server error' : err.message,
    });
  });

  return app;
}

function startServer(options = {}) {
  const env = options.env || process.env;
  const host = options.host || getBindHost(env);
  assertSafeToListen({ ...env, AUDIEAUX_HOST: host });
  const port = options.port != null ? options.port : getBindPort(env);
  const app = options.app || createApp({ env, uploadsDir: options.uploadsDir });
  const server = app.listen(port, host, () => {
    const address = server.address();
    const actualPort = address && address.port ? address.port : port;
    console.log(`Server is running at http://${host}:${actualPort}`);
  });
  return server;
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  createApp,
  startServer,
  getBindHost,
  getMaxUploadBytes,
  assertSafeToListen,
  isLoopbackHost,
  sniffAudioExtension,
};
