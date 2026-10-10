/**
 * howldr ProofWorks
 * LiquidFiles folder + share-file operations
 *
 * Endpoint shapes verified against the live appliance (v4.3, 2026-06-11):
 *   GET    /shares                                      → { shares: [...] }
 *   GET    /shares/{share_id}                           → { share: { root_folder: { id } } }
 *   POST   /shares/{share_id}/folders/{parent_id}       → { folder: { id } }   body { folder: { name } }
 *   POST   /shares/{share_id}/folders/{fid}/files/upload?name=x  (raw binary) → { file: { id } }
 *   DELETE /shares/{share_id}/folders/{fid}             → 204
 *
 * Folder ids are name-derived slugs (e.g. 'pol-2026-001-drafts'), so always
 * use the ids the API returns rather than predicting them.
 *
 * Folder structure per policy (docs/workflow-stages.md Stage 1):
 *   {share root}/POL-YYYY-NNN/
 *     current/
 *       training/
 *     drafts/
 *     archive/
 *     acknowledgements/
 */

const { request, requestBinary, LiquidFilesError } = require('./client');

/** Per-share root folder id cache: { [shareId]: folderId } */
const rootFolderCache = new Map();

/**
 * Root folder id for a share. LIQUIDFILES_ROOT_FOLDER_ID overrides (single-
 * share installs); otherwise resolved once from the share view and cached.
 */
async function getRootFolderId(shareId) {
  if (process.env.LIQUIDFILES_ROOT_FOLDER_ID) {
    return process.env.LIQUIDFILES_ROOT_FOLDER_ID;
  }
  if (rootFolderCache.has(shareId)) return rootFolderCache.get(shareId);
  const data = await request('GET', `/shares/${encodeURIComponent(shareId)}`);
  const id = data?.share?.root_folder?.id;
  if (!id) throw new Error(`share '${shareId}' has no root folder in API response`);
  rootFolderCache.set(shareId, id);
  return id;
}

/** List a folder's subfolders (includes soft-deleted ones). */
async function listSubfolders(shareId, folderId) {
  const data = await request(
    'GET',
    `/shares/${encodeURIComponent(shareId)}/folders/${encodeURIComponent(folderId)}`
  );
  return data?.folder?.folders ?? [];
}

/**
 * Create a single folder inside a share — idempotently.
 *
 * Folder ids are name-derived slugs and survive soft deletion, so creating
 * a name whose slug already exists (even deleted) returns 400. In that case
 * we find the existing folder under the same parent and reuse it, restoring
 * it first if it's in the trash. This also makes re-running policy
 * initiation idempotent.
 *
 * @param {string} shareId        - share id/slug (tenant's lf_share_name)
 * @param {string} name           - folder display name
 * @param {string} parentFolderId - parent folder id
 * @returns {Promise<object>} created or reused folder { id, name, ... }
 */
async function createFolder(shareId, name, parentFolderId) {
  try {
    const data = await request(
      'POST',
      `/shares/${encodeURIComponent(shareId)}/folders/${encodeURIComponent(parentFolderId)}`,
      { folder: { name } }
    );
    return data.folder;
  } catch (err) {
    if (!(err instanceof LiquidFilesError) || err.status !== 400) throw err;

    const siblings = await listSubfolders(shareId, parentFolderId);
    const existing = siblings.find(f => f.name === name);
    if (!existing) throw err;

    if (existing.deleted) {
      const data = await request(
        'POST',
        `/shares/${encodeURIComponent(shareId)}/folders/${encodeURIComponent(existing.id)}/restore`
      );
      console.warn(`[liquidfiles] restored deleted folder '${name}' (${existing.id})`);
      return data.folder;
    }
    console.warn(`[liquidfiles] reusing existing folder '${name}' (${existing.id})`);
    return existing;
  }
}

/**
 * Create the full folder hierarchy for a new policy.
 *
 * @param {string} shareId  - tenant's share (tenants.lf_share_name)
 * @param {string} policyId - e.g. 'POL-2026-001'
 * @returns {Promise<object>} folder ids:
 *   { root, current, training, drafts, archive, acks }
 */
async function createPolicyFolders(shareId, policyId) {
  const shareRoot = await getRootFolderId(shareId);
  const root = await createFolder(shareId, policyId, shareRoot);

  const current  = await createFolder(shareId, 'current',          root.id);
  const training = await createFolder(shareId, 'training',         current.id);
  const drafts   = await createFolder(shareId, 'drafts',           root.id);
  const archive  = await createFolder(shareId, 'archive',          root.id);
  const acks     = await createFolder(shareId, 'acknowledgements', root.id);

  return {
    root:     root.id,
    current:  current.id,
    training: training.id,
    drafts:   drafts.id,
    archive:  archive.id,
    acks:     acks.id,
  };
}

/**
 * Upload a file into a share folder (raw binary body).
 *
 * @param {string} shareId
 * @param {string} folderId
 * @param {string} filename  - stored name, e.g. 'POL-2026-001-v0.1.docx'
 * @param {Buffer} buffer
 * @param {string} [contentType]
 * @returns {Promise<object>} created file { id, name, size, checksum, ... }
 */
async function uploadFileToFolder(shareId, folderId, filename, buffer, contentType = 'application/octet-stream') {
  const path =
    `/shares/${encodeURIComponent(shareId)}/folders/${encodeURIComponent(folderId)}` +
    `/files/upload?name=${encodeURIComponent(filename)}`;
  const data = await request('POST', path, buffer, { headers: { 'Content-Type': contentType }, rawBody: true });
  return data.file;
}

/** List a folder's files (includes soft-deleted ones — filter on .deleted). */
async function listFiles(shareId, folderId) {
  const data = await request(
    'GET',
    `/shares/${encodeURIComponent(shareId)}/folders/${encodeURIComponent(folderId)}`
  );
  return data?.folder?.files ?? [];
}

/**
 * Download a file's bytes from a share folder.
 * Endpoint verified live: GET /shares/{s}/folders/{f}/files/{id}/download.
 *
 * @returns {Promise<{buffer: Buffer, contentType: string|null}>}
 */
async function downloadFile(shareId, folderId, fileId) {
  return requestBinary(
    'GET',
    `/shares/${encodeURIComponent(shareId)}/folders/${encodeURIComponent(folderId)}` +
    `/files/${encodeURIComponent(fileId)}/download`
  );
}

/**
 * Delete (trash) a file in a share folder.
 *
 * NOTE: endpoint shape inferred from the folder-delete route, not yet
 * verified against the live appliance — callers must treat failure as
 * non-fatal (e.g. archive-on-publish leaves the original in place and
 * warns rather than failing the distribution).
 */
async function deleteFile(shareId, folderId, fileId) {
  await request(
    'DELETE',
    `/shares/${encodeURIComponent(shareId)}/folders/${encodeURIComponent(folderId)}` +
    `/files/${encodeURIComponent(fileId)}`
  );
}

/**
 * Copy the newest non-deleted file from one share folder to another under
 * its existing name (download + re-upload; the appliance has no server-side
 * copy). Returns { name, file } or null when the source folder is empty.
 */
async function copyNewestFile(shareId, fromFolderId, toFolderId) {
  const files = (await listFiles(shareId, fromFolderId)).filter(f => !f.deleted);
  if (!files.length) return null;
  files.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const src = files[0];
  const { buffer, contentType } = await downloadFile(shareId, fromFolderId, src.id);
  const file = await uploadFileToFolder(
    shareId, toFolderId, src.name, buffer, src.content_type || contentType || undefined,
  );
  return { name: src.name, file };
}

/**
 * Create an archive subfolder for a specific major version (e.g. 'v1.0').
 * The previous version's files move here when a new major is published.
 */
async function createArchiveVersionFolder(shareId, archiveFolderId, version) {
  const folder = await createFolder(shareId, version, archiveFolderId);
  return folder.id;
}

module.exports = {
  createPolicyFolders,
  createArchiveVersionFolder,
  createFolder,
  uploadFileToFolder,
  listFiles,
  downloadFile,
  deleteFile,
  copyNewestFile,
  getRootFolderId,
  LiquidFilesError,
};
