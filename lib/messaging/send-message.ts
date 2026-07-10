import {
  createMessage,
  type ExtensionMessages,
  type MessageName,
} from './messages';

export async function sendMessage<TName extends MessageName>(
  type: TName,
  payload: ExtensionMessages[TName]['request'],
): Promise<ExtensionMessages[TName]['response']> {
  return browser.runtime.sendMessage(createMessage(type, payload));
}
