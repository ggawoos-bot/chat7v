import React, { useState } from 'react';

interface SourceInputProps {
  onAddSource: (source: { title: string; content: string; type: 'pdf' | 'text' | 'url' }) => void;
}

const SourceInput: React.FC<SourceInputProps> = ({ onAddSource }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<'pdf' | 'text' | 'url'>('text');
  const [isOpen, setIsOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    onAddSource({
      title: title.trim(),
      content: content.trim(),
      type,
    });

    setTitle('');
    setContent('');
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-brand-secondary text-brand-text-primary rounded-lg hover:bg-opacity-80 transition-colors"
      >
        소스 추가
      </button>
    );
  }

  return (
    <div className="p-4 bg-brand-surface border border-brand-secondary rounded-lg">
      <h3 className="text-lg font-semibold text-brand-text-primary mb-4">새 소스 추가</h3>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-brand-text-primary mb-2">
            제목
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="소스 제목을 입력하세요"
            className="w-full p-3 bg-brand-bg border border-brand-secondary rounded-lg text-brand-text-primary focus:outline-none focus:border-brand-primary"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-text-primary mb-2">
            타입
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'pdf' | 'text' | 'url')}
            className="w-full p-3 bg-brand-bg border border-brand-secondary rounded-lg text-brand-text-primary focus:outline-none focus:border-brand-primary"
          >
            <option value="text">텍스트</option>
            <option value="pdf">PDF</option>
            <option value="url">URL</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-text-primary mb-2">
            내용
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="소스 내용을 입력하세요"
            rows={4}
            className="w-full p-3 bg-brand-bg border border-brand-secondary rounded-lg text-brand-text-primary focus:outline-none focus:border-brand-primary resize-none"
            required
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            추가
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="px-4 py-2 bg-brand-secondary text-brand-text-primary rounded-lg hover:bg-opacity-80 transition-colors"
          >
            취소
          </button>
        </div>
      </form>
    </div>
  );
};

export default SourceInput;
