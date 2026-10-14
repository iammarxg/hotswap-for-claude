// DownloadItem.filename is supplied by the browser and includes any final rename.
export function absoluteExportLocation(filename) {
  if (typeof filename !== "string" || !/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+[\\/]|\/)/i.test(filename)) return null;
  const separator = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const directory = filename.slice(0, separator);
  return { path: filename, directory: /^[a-z]:$/i.test(directory) ? filename.slice(0, separator + 1) : directory || "/" };
}

export async function rememberExportLocation(downloadId) {
  const items = await chrome.downloads.search({ id: downloadId });
  const location = items?.[0]?.state === "complete" ? absoluteExportLocation(items[0].filename) : null;
  if (location) await chrome.storage.local.set({ lastSuccessfulExport: location });
  return location;
}
