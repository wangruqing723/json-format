export interface OpenedJsonFile {
  filePath: string | null;
  title: string;
  content: string;
}

export interface SavedJsonFile {
  filePath: string | null;
  title: string;
}

export interface SavedJsonFileAs extends SavedJsonFile {
  /** true 表示浏览器不支持选位置，已降级为下载 */
  fellBackToDownload: boolean;
}

interface BrowserSaveFileHandle {
  name: string;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
  }>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}

type ShowSaveFilePicker = (options?: SaveFilePickerOptions) => Promise<BrowserSaveFileHandle>;

export function isTauriRuntime() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() || '未命名.json';
}

function ensureJsonExtension(name: string) {
  return name.toLowerCase().endsWith('.json') ? name : `${name}.json`;
}

function pickBrowserFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json,text/json';
    input.multiple = true;
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

async function fromBrowserFiles(files: File[]): Promise<OpenedJsonFile[]> {
  return Promise.all(files.map(async (file) => ({
    filePath: null,
    title: file.name,
    content: await file.text(),
  })));
}

export async function openJsonFiles(): Promise<OpenedJsonFile[]> {
  if (!isTauriRuntime()) return fromBrowserFiles(await pickBrowserFiles());

  const [{ open }, { readTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const selection = await open({
    multiple: true,
    directory: false,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
  return Promise.all(paths.map(async (path) => ({
    filePath: path,
    title: basename(path),
    content: await readTextFile(path),
  })));
}

export async function readJsonPath(path: string): Promise<OpenedJsonFile> {
  if (!isTauriRuntime()) throw new Error('浏览器模式无法直接读取最近文件路径');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  return { filePath: path, title: basename(path), content: await readTextFile(path) };
}

export async function saveJsonFile(
  content: string,
  currentPath: string | null,
  currentTitle: string,
): Promise<SavedJsonFile | null> {
  const suggestedName = ensureJsonExtension(currentTitle.replace(/^未命名(?: \d+)?(?:\.json)?$/u, 'untitled'));

  if (isTauriRuntime()) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const path = currentPath ?? await save({
      defaultPath: suggestedName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return null;
    await writeTextFile(path, content);
    return { filePath: path, title: basename(path) };
  }

  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(url);
  return { filePath: null, title: suggestedName };
}

/** 强制弹出保存对话框，忽略文档已有路径。 */
export async function saveJsonFileAs(
  content: string,
  currentTitle: string,
): Promise<SavedJsonFileAs | null> {
  const suggestedName = ensureJsonExtension(currentTitle.replace(/^未命名(?: \d+)?(?:\.json)?$/u, 'untitled'));

  if (isTauriRuntime()) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return null;
    await writeTextFile(path, content);
    return { filePath: path, title: basename(path), fellBackToDownload: false };
  }

  const picker = (window as Window & { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const file = await picker({
        suggestedName,
        types: [{ description: 'JSON 文件', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await file.createWritable();
      await writable.write(content);
      await writable.close();
      return { filePath: null, title: basename(file.name), fellBackToDownload: false };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
  }

  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(url);
  return { filePath: null, title: suggestedName, fellBackToDownload: true };
}

export async function writeClipboardText(text: string) {
  if (isTauriRuntime()) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function revealFileInFolder(path: string) {
  if (!isTauriRuntime()) throw new Error('浏览器模式无法定位本地文件');
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}

export async function listenForJsonDrops(handler: (files: OpenedJsonFile[]) => void) {
  if (isTauriRuntime()) {
    const [{ getCurrentWebview }, { readTextFile }] = await Promise.all([
      import('@tauri-apps/api/webview'),
      import('@tauri-apps/plugin-fs'),
    ]);
    return getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== 'drop') return;
      const paths = event.payload.paths.filter((path) => path.toLowerCase().endsWith('.json'));
      const files = await Promise.all(paths.map(async (path) => ({
        filePath: path,
        title: basename(path),
        content: await readTextFile(path),
      })));
      if (files.length) handler(files);
    });
  }

  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? [])
      .filter((file) => file.name.toLowerCase().endsWith('.json'));
    if (files.length) handler(await fromBrowserFiles(files));
  };
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  return () => {
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('drop', onDrop);
  };
}
