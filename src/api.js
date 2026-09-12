export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || "请求失败");
    error.status = response.status;
    throw error;
  }
  return value;
}
export const send = (path, data, method = "POST") =>
  api(path, { method, body: JSON.stringify(data) });
export const bytes = (value) => {
  const n = Number(value) || 0;
  return Math.abs(n) < 1024
    ? `${n} B`
    : Math.abs(n) < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(2)} MB`;
};
export function uploadFile(file, collection, tags = [], onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const data = new FormData();
    data.set("file", file);
    data.set("title", file.name);
    data.set("tags", JSON.stringify(tags));
    if (collection && collection !== "unfiled")
      data.set("collection_id", collection);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name) ? '/api/videos' : '/api/assets');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () =>
      reject(new Error("网络连接失败，可重试；重复文件会自动复用"));
    xhr.onload = () => {
      try {
        const value = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300)
          reject(new Error(value.error || "上传失败"));
        else resolve(value);
      } catch {
        reject(new Error("服务器返回格式错误"));
      }
    };
    xhr.send(data);
  });
}
