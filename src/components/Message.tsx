import type { Message as MessageType } from '../message';

type Props = { message: MessageType };

export function Message({ message }: Props) {
  return (
    <section
      className={`message-card message-card--${message.type}`}
      aria-label="Family message"
    >
      <p className="message-text">{message.text}</p>
    </section>
  );
}
