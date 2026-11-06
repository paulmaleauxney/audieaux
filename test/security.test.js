const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const {
  assertSafeToListen,
  createApp,
  getBindHost,
  isLoopbackHost,
} = require('../server');

const openServers = [];
const tempDirs = [];

function makeTempUploadsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audieaux-uploads-'));
  tempDirs.push(dir);
  return dir;
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      openServers.push(server);
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

function minimalWav(extraBytes = 0) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + extraBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(extraBytes, 40);
  return extraBytes > 0 ? Buffer.concat([header, Buffer.alloc(extraBytes)]) : header;
}

function multipartBody({ filename, contentType, buffer, fieldName = 'audio' }) {
  const boundary = `----AudieauxTest${process.hrtime.bigint()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([preamble, buffer, closing]),
  };
}

async function request(baseUrl, pathname, options = {}) {
  const url = new URL(pathname, baseUrl);
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, text, json };
}

async function postUpload(baseUrl, file, headers = {}) {
  const { contentType, body } = multipartBody(file);
  return request(baseUrl, '/upload', {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      ...headers,
    },
    body,
  });
}

after(async () => {
  await Promise.all(
    openServers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(() => resolve());
        })
    )
  );
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('binds to loopback by default', () => {
  assert.equal(getBindHost({}), '127.0.0.1');
  assert.equal(getBindHost({ HOST: '' }), '127.0.0.1');
  assert.equal(getBindHost({ AUDIEAUX_HOST: '127.0.0.1' }), '127.0.0.1');
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
});

test('fail-closed refuses non-loopback bind without AUDIEAUX_UPLOAD_TOKEN', () => {
  assert.throws(
    () => assertSafeToListen({ AUDIEAUX_HOST: '0.0.0.0' }),
    /AUDIEAUX_UPLOAD_TOKEN/
  );
  assert.throws(
    () => assertSafeToListen({ HOST: '0.0.0.0' }),
    /non-loopback/
  );
  assert.doesNotThrow(() => assertSafeToListen({}));
  assert.doesNotThrow(() => assertSafeToListen({ AUDIEAUX_HOST: '127.0.0.1' }));
  assert.doesNotThrow(() =>
    assertSafeToListen({
      AUDIEAUX_HOST: '0.0.0.0',
      AUDIEAUX_UPLOAD_TOKEN: 'secret-token',
    })
  );
});

test('process exits when started on 0.0.0.0 without a token', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      PATH: process.env.PATH,
      HOST: '0.0.0.0',
      AUDIEAUX_HOST: '0.0.0.0',
      PORT: '0',
    },
  });
  const stderrChunks = [];
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.notEqual(code, 0);
  assert.match(Buffer.concat(stderrChunks).toString(), /AUDIEAUX_UPLOAD_TOKEN/);
});

test('sets security headers on responses', async () => {
  const { baseUrl } = await listen(createApp({ uploadsDir: makeTempUploadsDir() }));
  const { response } = await request(baseUrl, '/');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('enforces bearer/token auth on POST /upload when AUDIEAUX_UPLOAD_TOKEN is set', async () => {
  const uploadsDir = makeTempUploadsDir();
  const { baseUrl } = await listen(
    createApp({
      env: { AUDIEAUX_UPLOAD_TOKEN: 'correct-token' },
      uploadsDir,
    })
  );
  const wav = {
    filename: 'clip.wav',
    contentType: 'audio/wav',
    buffer: minimalWav(),
  };

  const missing = await postUpload(baseUrl, wav);
  assert.equal(missing.response.status, 401);

  const wrongBearer = await postUpload(baseUrl, wav, {
    Authorization: 'Bearer wrong-token',
  });
  assert.equal(wrongBearer.response.status, 401);

  const okBearer = await postUpload(baseUrl, wav, {
    Authorization: 'Bearer correct-token',
  });
  assert.equal(okBearer.response.status, 200);
  assert.equal(okBearer.json.success, true);

  const okHeader = await postUpload(baseUrl, wav, {
    'X-Upload-Token': 'correct-token',
  });
  assert.equal(okHeader.response.status, 200);
});

test('rejects oversized payloads with 413', async () => {
  const uploadsDir = makeTempUploadsDir();
  const { baseUrl } = await listen(
    createApp({
      env: { AUDIEAUX_MAX_UPLOAD_BYTES: '100' },
      uploadsDir,
    })
  );
  const { response, json } = await postUpload(baseUrl, {
    filename: 'loud.wav',
    contentType: 'audio/wav',
    buffer: minimalWav(200),
  });
  assert.equal(response.status, 413);
  assert.equal(json.success, false);
  assert.equal(fs.readdirSync(uploadsDir).length, 0);
});

test('rejects disallowed file types with 415', async () => {
  const uploadsDir = makeTempUploadsDir();
  const { baseUrl } = await listen(createApp({ uploadsDir }));

  const textFile = await postUpload(baseUrl, {
    filename: 'note.txt',
    contentType: 'text/plain',
    buffer: Buffer.from('not audio'),
  });
  assert.equal(textFile.response.status, 415);

  const htmlFile = await postUpload(baseUrl, {
    filename: 'index.html',
    contentType: 'text/html',
    buffer: Buffer.from('<script>alert(1)</script>'),
  });
  assert.equal(htmlFile.response.status, 415);

  const mimeMismatch = await postUpload(baseUrl, {
    filename: 'clip.wav',
    contentType: 'application/javascript',
    buffer: minimalWav(),
  });
  assert.equal(mimeMismatch.response.status, 415);

  assert.equal(fs.readdirSync(uploadsDir).length, 0);
});

test('stores uploads under a server-generated name inside uploads/', async () => {
  const uploadsDir = makeTempUploadsDir();
  const { baseUrl } = await listen(createApp({ uploadsDir }));
  const { response, json } = await postUpload(baseUrl, {
    filename: '../../../etc/passwd.wav',
    contentType: 'audio/wav',
    buffer: minimalWav(),
  });
  assert.equal(response.status, 200);
  assert.equal(json.success, true);

  const stored = fs.readdirSync(uploadsDir);
  assert.equal(stored.length, 1);
  assert.match(stored[0], /^[0-9a-f-]{36}\.wav$/i);
  assert.equal(stored[0].includes('passwd'), false);
  assert.equal(fs.existsSync(path.join(uploadsDir, stored[0])), true);
});
