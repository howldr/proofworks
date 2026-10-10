/**
 * howldr ProofWorks
 * LiquidFiles API client
 *
 * Config is read lazily — the app boots fine without LiquidFiles credentials;
 * errors only surface when an actual API call is attempted.
 */

function getConfig() {
  const BASE_URL = process.env.LIQUIDFILES_BASE_URL;
  const API_KEY  = process.env.LIQUIDFILES_API_KEY;
  if (!BASE_URL || !API_KEY) {
    throw new Error('LIQUIDFILES_BASE_URL and LIQUIDFILES_API_KEY must be set before sending messages');
  }
  return { BASE_URL, API_KEY };
}

async function request(method, apiPath, body = null, opts = {}) {
  const { BASE_URL, API_KEY } = getConfig();
  const url = `${BASE_URL}${apiPath}`;

  const headers = {
    'Authorization': `Basic ${Buffer.from(API_KEY + ':x').toString('base64')}`,
    'Accept':        'application/json',
    'Content-Type':  'application/json',
    ...opts.headers,
  };

  const options = { method, headers };
  if (body != null) options.body = opts.rawBody ? body : JSON.stringify(body);

  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(`[liquidfiles] ${response.status} ${response.statusText} at ${apiPath}: ${text}`);
    throw new LiquidFilesError(response.status, response.statusText, text, apiPath);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function uploadAttachment(fileBuffer, filename, mimeType = 'application/octet-stream') {
  const { BASE_URL, API_KEY } = getConfig();
  const url = `${BASE_URL}/message/attachments/upload?filename=${encodeURIComponent(filename)}`;

  const response = await fetch(url, {
    method:  'POST',
    headers: {
      // Match request(): LiquidFiles accepts the API key as HTTP Basic username (verified against sft.howldr.com).
      'Authorization': `Basic ${Buffer.from(API_KEY + ':x').toString('base64')}`,
      'Accept':        'application/json',
      'Content-Type':  mimeType,
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new LiquidFilesError(response.status, response.statusText, text, '/message/attachments/upload');
  }

  const data = await response.json();
  return data.attachment.id;
}

/** GET a binary resource (e.g. share file download). Returns { buffer, contentType }. */
async function requestBinary(method, apiPath) {
  const { BASE_URL, API_KEY } = getConfig();
  const response = await fetch(`${BASE_URL}${apiPath}`, {
    method,
    headers: {
      'Authorization': `Basic ${Buffer.from(API_KEY + ':x').toString('base64')}`,
      'Accept':        '*/*',
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new LiquidFilesError(response.status, response.statusText, text, apiPath);
  }
  return {
    buffer:      Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type'),
  };
}

class LiquidFilesError extends Error {
  constructor(status, statusText, body, apiPath) {
    super(`LiquidFiles API error ${status} ${statusText} at ${apiPath}`);
    this.status     = status;
    this.statusText = statusText;
    this.body       = body;
    this.path       = apiPath;
  }
}

module.exports = { request, requestBinary, uploadAttachment, LiquidFilesError };
