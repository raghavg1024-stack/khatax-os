/** Only application-authored messages may be returned verbatim to the browser. */
export class UserInputError extends Error {
  constructor(
    message: string,
    public readonly code = "invalid_request",
  ) {
    super(message);
  }
}
