'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { useEffect } from 'react';

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  maxLength?: number;
};

export function MarkdownEditor({ value, onChange, maxLength = 65536 }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value || '',
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'prose prose-sm max-w-none min-h-[160px] focus:outline-none' },
    },
    onUpdate({ editor: e }) {
      const md = (e.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? e.getText();
      if (md.length > maxLength) {
        // Truncate UI by re-setting content to the truncated value
        e.commands.setContent(md.slice(0, maxLength));
        return;
      }
      onChange(md);
    },
  });

  useEffect(() => {
    if (!editor) return;
    if ((editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() !== value) {
      editor.commands.setContent(value || '');
    }
  }, [value, editor]);

  if (!editor) return <div className="rounded border border-gray-300 p-3 text-sm text-gray-500">编辑器加载中…</div>;

  return (
    <div className="rounded border border-gray-300">
      <div className="flex flex-wrap gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1 text-xs">
        <ToolbarBtn editor={editor} cmd={(e) => e.chain().focus().toggleBold().run()} active={editor.isActive('bold')}>
          B
        </ToolbarBtn>
        <ToolbarBtn editor={editor} cmd={(e) => e.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}>
          I
        </ToolbarBtn>
        <ToolbarBtn
          editor={editor}
          cmd={(e) => {
            const url = window.prompt('链接 URL', 'https://');
            if (!url) return;
            e.chain().focus().setLink({ href: url }).run();
          }}
        >
          🔗
        </ToolbarBtn>
        <ToolbarBtn editor={editor} cmd={(e) => e.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')}>
          {'</>'}
        </ToolbarBtn>
        <ToolbarBtn editor={editor} cmd={(e) => e.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}>
          •
        </ToolbarBtn>
        <ToolbarBtn editor={editor} cmd={(e) => e.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>
          H2
        </ToolbarBtn>
      </div>
      <EditorContent editor={editor} className="px-3 py-2" />
      <div className="border-t border-gray-200 px-2 py-1 text-right text-xs text-gray-500">
        {((editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? editor.getText()).length} / {maxLength} 字符
      </div>
    </div>
  );
}

function ToolbarBtn({
  editor,
  cmd,
  active,
  children,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  cmd: (e: typeof editor) => unknown;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => cmd(editor)}
      className={`rounded px-2 py-1 ${active ? 'bg-gray-300' : 'hover:bg-gray-200'}`}
    >
      {children}
    </button>
  );
}
