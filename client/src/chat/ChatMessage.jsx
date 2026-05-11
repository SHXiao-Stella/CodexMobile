import { Check, Copy, CornerDownRight, HelpCircle, Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../app/session-utils.js';
import { copyTextToClipboard } from '../utils/clipboard.js';
import { ActivityMessage } from './ActivityMessage.jsx';
import { MessageContent, splitMessageImages } from './MarkdownContent.jsx';
import { PlanMessage } from './PlanMessage.jsx';
import { UserImageStrip } from './ImagePreview.jsx';

function UserInputRequestMessage({ message, onSubmitUserInput }) {
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const answered = message.status === 'answered';
  const questions = Array.isArray(message.questions) ? message.questions : [];

  function questionKey(question, index) {
    return question?.id || `question-${index}`;
  }

  function setQuestionAnswer(questionId, value) {
    setAnswers((current) => ({
      ...current,
      [questionId]: { answers: value ? [value] : [] }
    }));
  }

  async function submit(nextAnswers) {
    setBusy(true);
    setError('');
    try {
      await onSubmitUserInput?.(message, nextAnswers);
    } catch (submitError) {
      setError(submitError.message || '提交失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="message-row is-activity">
      <div className={`message-bubble user-input-card ${answered ? 'is-answered' : ''}`}>
        <div className="user-input-card-head">
          {answered ? <Check size={16} /> : <HelpCircle size={16} />}
          <span>{answered ? '已提交选择' : '等待你的选择'}</span>
        </div>
        {questions.map((question, index) => {
          const id = questionKey(question, index);
          const selectedAnswer = answers[id]?.answers?.[0] || '';
          const hasOptions = Array.isArray(question.options) && question.options.length > 0;
          const disabled = busy || answered;
          return (
            <div key={id} className="user-input-question">
              {question.header ? <strong>{question.header}</strong> : null}
              {question.question ? <p>{question.question}</p> : null}
              {hasOptions ? (
                <div className="user-input-options">
                  {question.options.map((option, optionIndex) => {
                    const optionLabel = String(option?.label || '');
                    const optionKey = optionLabel || `option-${optionIndex}`;
                    return (
                      <button
                        key={optionKey}
                        type="button"
                        className={selectedAnswer === optionLabel ? 'is-selected' : ''}
                        disabled={disabled}
                        onClick={() => setQuestionAnswer(id, optionLabel)}
                      >
                        <span>{optionLabel}</span>
                        {option.description ? <small>{option.description}</small> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {question.isOther || !hasOptions ? (
                <input
                  type={question.isSecret ? 'password' : 'text'}
                  value={selectedAnswer}
                  disabled={disabled}
                  onChange={(event) => setQuestionAnswer(id, event.target.value)}
                />
              ) : null}
            </div>
          );
        })}
        {error || message.error ? <div className="user-input-error">{error || message.error}</div> : null}
        {!answered ? (
          <div className="user-input-actions">
            <button type="button" disabled={busy} onClick={() => submit(answers)}>
              {busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
              <span>提交</span>
            </button>
            <button type="button" disabled={busy} onClick={() => submit({})}>
              <X size={15} />
              <span>取消</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ChatMessage({ message, now, onPreviewImage, onDeleteMessage, onImplementPlan, onAdjustPlan, onSubmitUserInput }) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  if (message.role === 'activity') {
    return <ActivityMessage message={message} now={now} onImplementPlan={onImplementPlan} />;
  }
  if (message.role === 'user_input_request') {
    return <UserInputRequestMessage message={message} onSubmitUserInput={onSubmitUserInput} />;
  }
  if (message.role === 'plan' || message.role === 'plan_request') {
    return (
      <PlanMessage
        message={message}
        onPreviewImage={onPreviewImage}
        onImplementPlan={onImplementPlan}
        onAdjustPlan={onAdjustPlan}
      />
    );
  }
  const isUser = message.role === 'user';
  const isGuided = isUser && (message.guided || message.kind === 'guided_user');
  const canAct = message.role === 'user' || message.role === 'assistant';
  const userMedia = isUser ? splitMessageImages(message.content) : { text: message.content, images: [] };
  const visibleContent = isUser ? userMedia.text : message.content;

  async function handleCopy() {
    const copiedText = await copyTextToClipboard(message.content);
    if (!copiedText) {
      window.alert('复制失败');
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`message-row ${isUser ? 'is-user' : 'is-assistant'}`}>
      <div className="message-stack">
        {isGuided ? (
          <div className="message-guide-label">
            <CornerDownRight size={13} strokeWidth={1.8} />
            <span>{message.guideLabel || '已引导对话'}</span>
          </div>
        ) : null}
        {isUser ? <UserImageStrip images={userMedia.images} onPreviewImage={onPreviewImage} /> : null}
        {visibleContent ? (
          <div className="message-bubble">
            <MessageContent content={visibleContent} onPreviewImage={onPreviewImage} />
            {message.timestamp ? <time>{formatTime(message.timestamp)}</time> : null}
          </div>
        ) : null}
        {canAct ? (
          <div className="message-actions" aria-label="消息操作">
            <button type="button" className="message-action" onClick={handleCopy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
            <button type="button" className="message-action is-delete" onClick={() => onDeleteMessage?.(message)}>
              <Trash2 size={13} />
              <span>删除</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
