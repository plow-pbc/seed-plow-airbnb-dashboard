import type { Message } from './message';

export function msg(overrides: Partial<Message> = {}): Message {
  return {
    type: 'affirmation',
    text: 'hi',
    expires_at: null,
    ...overrides,
  };
}
