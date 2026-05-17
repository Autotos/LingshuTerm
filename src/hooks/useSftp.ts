import { useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSftpStore, type SftpFileEntry } from '@/stores/sftpStore';

export function useSftp(sessionId: string | null) {
  const store = useSftpStore();
  const pendingRef = useRef<Map<string, Promise<SftpFileEntry[]>>>(new Map());

  const listDir = useCallback(
    async (path: string): Promise<SftpFileEntry[]> => {
      if (!sessionId) return [];

      const cacheKey = `${sessionId}:${path}`;

      // Deduplicate concurrent requests
      const pending = pendingRef.current.get(cacheKey);
      if (pending) return pending;

      // Check cache using FRESH state (not closure's stale `store`)
      const freshListings = useSftpStore.getState().listings;
      const cached = freshListings[cacheKey];
      if (cached) return cached;

      store.setLoading(cacheKey, true);
      store.setError(cacheKey, null);

      const promise = invoke<SftpFileEntry[]>('sftp_list_dir', { sessionId, path })
        .then((entries) => {
          store.setListing(cacheKey, entries);
          store.setLoading(cacheKey, false);
          return entries;
        })
        .catch((err: string) => {
          store.setLoading(cacheKey, false);
          store.setError(cacheKey, err);
          return [];
        })
        .finally(() => {
          pendingRef.current.delete(cacheKey);
        });

      pendingRef.current.set(cacheKey, promise);
      return promise;
    },
    [sessionId, store],
  );

  const readFile = useCallback(
    async (path: string): Promise<string> => {
      if (!sessionId) return '';
      return invoke<string>('sftp_read_file', { sessionId, path });
    },
    [sessionId],
  );

  const writeFile = useCallback(
    async (path: string, content: string): Promise<void> => {
      if (!sessionId) return;
      await invoke('sftp_write_file', { sessionId, path, content });
      // Invalidate parent cache using fresh state
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      const cacheKey = `${sessionId}:${parentPath}`;
      const fresh = useSftpStore.getState();
      const next = { ...fresh.listings };
      delete next[cacheKey];
      useSftpStore.setState({ listings: next });
    },
    [sessionId],
  );

  const uploadFile = useCallback(
    async (localPath: string, remotePath: string): Promise<void> => {
      if (!sessionId) return;
      await invoke('sftp_upload_file', { sessionId, localPath, remotePath });
    },
    [sessionId],
  );

  const downloadFile = useCallback(
    async (remotePath: string, localPath: string): Promise<void> => {
      if (!sessionId) return;
      await invoke('sftp_download_file', { sessionId, remotePath, localPath });
    },
    [sessionId],
  );

  const homeDir = useCallback(
    async (): Promise<string> => {
      if (!sessionId) return '/';
      return invoke<string>('sftp_home_dir', { sessionId });
    },
    [sessionId],
  );

  const deleteItem = useCallback(
    async (path: string, isDir: boolean): Promise<void> => {
      if (!sessionId) return;
      await invoke('sftp_delete_item', { sessionId, path, isDir });
      // Invalidate parent cache using fresh state
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      const cacheKey = `${sessionId}:${parentPath}`;
      const fresh = useSftpStore.getState();
      const next = { ...fresh.listings };
      delete next[cacheKey];
      useSftpStore.setState({ listings: next });
    },
    [sessionId],
  );

  const renameItem = useCallback(
    async (oldPath: string, newName: string): Promise<void> => {
      if (!sessionId) return;
      const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
      const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`;
      await invoke('sftp_rename_item', { sessionId, oldPath, newPath });
      // Invalidate parent cache using fresh state
      const cacheKey = `${sessionId}:${parentPath}`;
      const fresh = useSftpStore.getState();
      const next = { ...fresh.listings };
      delete next[cacheKey];
      useSftpStore.setState({ listings: next });
    },
    [sessionId],
  );

  const fileProperties = useCallback(
    async (path: string): Promise<any> => {
      if (!sessionId) return null;
      return invoke('sftp_file_properties', { sessionId, path });
    },
    [sessionId],
  );

  const createDir = useCallback(
    async (path: string): Promise<void> => {
      if (!sessionId) return;
      await invoke('sftp_create_dir', { sessionId, path });
      // Invalidate parent cache
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      const cacheKey = `${sessionId}:${parentPath}`;
      const fresh = useSftpStore.getState();
      const next = { ...fresh.listings };
      delete next[cacheKey];
      useSftpStore.setState({ listings: next });
    },
    [sessionId],
  );

  const createFile = useCallback(
    async (path: string): Promise<void> => {
      if (!sessionId) return;
      await invoke('sftp_create_file', { sessionId, path });
      // Invalidate parent cache
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      const cacheKey = `${sessionId}:${parentPath}`;
      const fresh = useSftpStore.getState();
      const next = { ...fresh.listings };
      delete next[cacheKey];
      useSftpStore.setState({ listings: next });
    },
    [sessionId],
  );

  return { listDir, readFile, writeFile, uploadFile, downloadFile, homeDir, deleteItem, renameItem, fileProperties, createDir, createFile };
}
