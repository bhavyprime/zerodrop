export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || 'Something went wrong. Please try again.');
    this.status = status;
    this.data = data ?? {};
  }
}

async function request(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, { error: 'Could not reach the server. Check your connection and try again.' });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const getLimits = () => request('/api/health');

/** Uploads with progress (0..1). Resolves with the created drop. */
export function createDrop({ file, expiresIn, maxDownloads, password }, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('expiresIn', expiresIn);
    form.append('maxDownloads', String(maxDownloads));
    if (password) form.append('password', password);
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/drops');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new ApiError(xhr.status, xhr.response));
    };
    xhr.onerror = () =>
      reject(new ApiError(0, { error: 'Could not reach the server. Check your connection and try again.' }));
    xhr.send(form);
  });
}

export const accessDrop = (code, password) =>
  request('/api/drops/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, password: password || undefined }),
  });

export const getSenderStatus = (dropId, token) =>
  request(`/api/drops/${dropId}/status`, { headers: { 'x-sender-token': token } });

export const downloadUrl = (dropId, ticket) =>
  `/api/drops/${dropId}/download?ticket=${encodeURIComponent(ticket)}`;
