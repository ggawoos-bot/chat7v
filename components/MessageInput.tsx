import React, { useState } from 'react';
import SendIcon from './icons/SendIcon';

interface MessageInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const MessageInput: React.FC<MessageInputProps> = ({ 
  onSendMessage, 
  disabled = false, 
  placeholder = "메시지를 입력하세요..." 
}) => {
  const [message, setMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || disabled) return;
    
    onSendMessage(message.trim());
    setMessage('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-2 md:p-4 bg-brand-surface border-t border-brand-secondary">
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyPress={handleKeyPress}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 p-2 md:p-3 bg-brand-bg border border-brand-secondary rounded-lg text-brand-text-primary focus:outline-none focus:border-brand-primary disabled:opacity-50 disabled:cursor-not-allowed text-sm md:text-base"
      />
      <button
        type="submit"
        disabled={disabled || !message.trim()}
        className="px-3 py-2 md:px-4 md:py-3 bg-brand-primary text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
      >
        <SendIcon className="w-4 h-4 md:w-5 md:h-5" />
      </button>
    </form>
  );
};

export default MessageInput;