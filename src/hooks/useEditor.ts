import { useEffect, useRef, useCallback } from 'react';
import type { MonacoInstance } from '@/lib/monaco';

interface UseEditorOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  language?: string;
  value?: string;
  /** 内容变更时的回调（用于同步到 editorStore） */
  onChange?: (value: string) => void;
}

export function useEditor({ containerRef, language = 'plaintext', value = '', onChange }: UseEditorOptions) {
  const instanceRef = useRef<MonacoInstance | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // 把最新的 language / value 缓存到 ref，避免让它们变动触发 useEffect 重新创建 editor
  const initialConfigRef = useRef({ language, value });
  initialConfigRef.current = { language, value };

  useEffect(() => {
    if (!containerRef.current || instanceRef.current) return;

    // StrictMode 下 useEffect 会连续 mount 两次，异步 import 完成后有可能容器已被下一次 mount 使用
    // 用 cancelled 标志 + 二次检查 instanceRef 避免对同一 DOM 节点重复创建 editor
    let cancelled = false;
    let pendingInstance: MonacoInstance | null = null;
    let disposeOnChange: { dispose(): void } | null = null;

    import('@/lib/monaco').then(({ createMonacoEditor }) => {
      if (cancelled || !containerRef.current || instanceRef.current) return;
      const instance = createMonacoEditor(containerRef.current, {
        value: initialConfigRef.current.value,
        language: initialConfigRef.current.language,
      });
      pendingInstance = instance;
      instanceRef.current = instance;
      // 监听内容变更，转发到 onChange 回调
      disposeOnChange = instance.editor.onDidChangeModelContent(() => {
        onChangeRef.current?.(instance.editor.getValue());
      });
    });

    return () => {
      cancelled = true;
      try {
        disposeOnChange?.dispose();
      } catch {
        /* ignore */
      }
      // 优先 dispose 当前 useEffect 内创建的实例（即使还没来得及写入 instanceRef，pendingInstance 也能捕获到）
      const toDispose = pendingInstance ?? instanceRef.current;
      try {
        toDispose?.dispose();
      } catch {
        /* ignore */
      }
      if (instanceRef.current === toDispose) {
        instanceRef.current = null;
      }
    };
    // 仅依赖 containerRef；language / value 仅用于初始化，后续变更通过 setValue / setLanguage 接口处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  const setValue = useCallback((newValue: string) => {
    const inst = instanceRef.current?.editor;
    if (!inst) return;
    // 避免相同内容 setValue 触发 onChange 回涌
    if (inst.getValue() !== newValue) {
      inst.setValue(newValue);
    }
  }, []);

  const getValue = useCallback(() => {
    return instanceRef.current?.editor.getValue() ?? '';
  }, []);

  const layout = useCallback(() => {
    instanceRef.current?.editor.layout();
  }, []);

  return { setValue, getValue, layout };
}
