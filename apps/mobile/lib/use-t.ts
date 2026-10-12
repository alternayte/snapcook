import { useIntl } from "react-intl";
import type { MessageId } from "@/lib/messages/en";

/** The one way a screen gets its words: by message id, checked at compile time. */
export function useT() {
  const intl = useIntl();
  return (id: MessageId, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
}
