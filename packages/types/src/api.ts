/**
 * Every non-2xx API response uses this envelope. `code` is a stable machine-readable
 * identifier clients may branch on; `message` is safe to display and never contains
 * stack traces, SQL, or secret values.
 */
export interface ApiErrorBody<TCode extends string = string> {
  error: {
    code: TCode;
    message: string;
    requestId?: string;
    details?: ApiErrorDetail[];
  };
}

/** Field-level detail, currently produced only for validation failures. */
export interface ApiErrorDetail {
  path: string;
  message: string;
}
